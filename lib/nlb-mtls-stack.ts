import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import * as apigw from "@aws-cdk/aws-apigateway";
import * as lambda from "@aws-cdk/aws-lambda";
import * as iam from "@aws-cdk/aws-iam";
import * as s3 from "@aws-cdk/aws-s3";

export class NLBNginxStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // Create an S3 bucket for staging scripts/certs bundle
    const stagingBucket = new s3.Bucket(this, "StagingBundleBucket", {});

    // Creates new VPC with 2 AZs, each having 1 public and 1 private subnet
    const vpc = new ec2.Vpc(this, "MTLSVPC", {
      cidr: "10.0.0.0/16",
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "nlb-sn",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "nginx-sn",
          subnetType: ec2.SubnetType.ISOLATED,
          cidrMask: 24,
        },
        {
          name: "lambda-sn",
          subnetType: ec2.SubnetType.ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true
    });

    // List all public subnets in the VPC
    const publicSN = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    });

    // List all private subnets in the VPC
    const privateSN = vpc.selectSubnets({
      subnetType: ec2.SubnetType.ISOLATED,
    });

    // Loop through the list of public subnet to find the subnets to put Nginx / NLB
    const nginxSNs: ec2.ISubnet[] = [];
    const nlbSNs: ec2.ISubnet[] = [];
    vpc.publicSubnets.forEach((pubSN) => {
      if (pubSN.node.id.includes("nlb")) {
        nlbSNs.push(pubSN);
      }
    });
    vpc.isolatedSubnets.forEach((priSN) => {
      if (priSN.node.id.includes("nginx")) {
        nginxSNs.push(priSN);
      }
    });

    // Find subnets to place API Gateway
    const apiGWSNs: ec2.ISubnet[] = [];
    vpc.isolatedSubnets.forEach((priSN) => {
      if (priSN.node.id.includes("lambda")) {
        apiGWSNs.push(priSN);
      }
    });
    
    // Create new security group for the Nginx auto-scaling group
    const nginxSG = new ec2.SecurityGroup(this, "nginxSG", {
      vpc,
      securityGroupName: "nginxSG",
    });

    // Add inbound HTTPS rule for the Nginx
    nginxSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));

    // Create role for the ec2 auto-scaling group, which enables SSM
    const ec2Role = new iam.Role(this, "ec2-role", {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("ec2.amazonaws.com"),
        new iam.ServicePrincipal("ssm.amazonaws.com")
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromManagedPolicyArn(
          this,
          "ssmManaged",
          "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // Create auto-scaling group for the Nginx EC2s
    const asg = new autoscaling.AutoScalingGroup(this, "NginxASG", {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: new ec2.AmazonLinuxImage(),
      vpc,
      vpcSubnets: vpc.selectSubnets({
        subnets: nginxSNs,
      }),
      securityGroup: nginxSG,
      keyName: "gaiuswkp1",
      minCapacity: 2,
      role: ec2Role,
    });

    // Grant S3 staging bucket read access to the EC2s
    stagingBucket.grantRead(ec2Role);

    // Create NLB for the Nginx auto-scaling group
    const nlb = new elbv2.NetworkLoadBalancer(this, "mtlsNLB", {
      vpc,
      crossZoneEnabled: true,
      internetFacing: true,
      loadBalancerName: "mtls-demo-nlb",
      vpcSubnets: vpc.selectSubnets({
        subnets: nlbSNs,
      }),
    });

    const nlbURL: string = nlb.loadBalancerDnsName;

    const nlbHTTPListener = nlb.addListener("HTTPInbound", {
      port: 80,
    });

    nlbHTTPListener.addTargets("NginxFleet", {
      port: 80,
      targets: [asg],
    });

    const nlbHTTPSListener = nlb.addListener("HTTPSInbound", {
      port: 443,
    });

    nlbHTTPSListener.addTargets("NginxFleet", {
      port: 443,
      targets: [asg],
    });

    // Add inbound HTTP rule for the Nginx
    nginxSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    nginxSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    // Add S3 Endpoint so installing Nginx does not require Internet access
    vpc.addS3Endpoint("s3-gateway");

    // Add interface endpoints for SSM
    vpc.addInterfaceEndpoint("ssm-messages", {
      open: true,
      privateDnsEnabled: true,
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      subnets: vpc.selectSubnets({
        subnets: nginxSNs,
      }),
      securityGroups: [nginxSG],
    });

    vpc.addInterfaceEndpoint("ec2-messages", {
      open: true,
      privateDnsEnabled: true,
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      subnets: vpc.selectSubnets({
        subnets: nginxSNs,
      }),
      securityGroups: [nginxSG],
    });

    vpc.addInterfaceEndpoint("ssm", {
      open: true,
      privateDnsEnabled: true,
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      subnets: vpc.selectSubnets({
        subnets: nginxSNs,
      }),
      securityGroups: [nginxSG],
    });

    vpc.addInterfaceEndpoint("ec2", {
      open: true,
      privateDnsEnabled: true,
      service: ec2.InterfaceVpcEndpointAwsService.EC2,
      subnets: vpc.selectSubnets({
        subnets: nginxSNs,
      }),
      securityGroups: [nginxSG],
    });

    // Create security group for API Gateway
    const apiGWSG = new ec2.SecurityGroup(this, "apiGWSG", {
      vpc,
      securityGroupName: "apiGWSG",
    });

    // Add inbound HTTPS rule for the API Gateway if it comes from the Nginx
    apiGWSG.addIngressRule(nginxSG, ec2.Port.tcp(443));

    // Create VPC Endpoint for the API Gateway
    const apiGWVpcE = new ec2.InterfaceVpcEndpoint(this, "PrivateApiEndpoint", {
      vpc,
      service: {
        name: "com.amazonaws.us-west-2.execute-api",
        port: 443,
      },
      privateDnsEnabled: true,
      subnets: vpc.selectSubnets({
        subnets: apiGWSNs,
      }),
      securityGroups: [apiGWSG],
      open: true,
    });

    // Create private lambda API for testing MTLS, only accessible within VPC
    const privateHelloWorldLambda = new lambda.Function(
      this,
      "PrivateHelloWorldFunction",
      {
        code: lambda.Code.fromAsset(`${__dirname}/../lambda`),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_12_X,
      }
    );

    const privateAPI = new apigw.LambdaRestApi(this, "PrivateApiForTesting", {
      handler: privateHelloWorldLambda,
      endpointTypes: [apigw.EndpointType.PRIVATE],
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
            effect: iam.Effect.DENY,
            conditions: {
              StringNotEquals: {
                "aws:SourceVpce": apiGWVpcE.vpcEndpointId,
              },
            },
          }),
          new iam.PolicyStatement({
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
            effect: iam.Effect.ALLOW,
          }),
        ],
      }),
    });

    new cdk.CfnOutput(this, "nlb-endpoint", {
      value: nlb.loadBalancerDnsName,
      description: "DNS name of the Network Load Balancer",
    });

    new cdk.CfnOutput(this, "S3BucketName", {
      value: stagingBucket.bucketName,
      description: "Name of the staging S3 bucket"
    });

  }
}
