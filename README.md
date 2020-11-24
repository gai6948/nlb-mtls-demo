# Implementing Mutual TLS (MTLS) on NLB + Nginx EC2

This example shows you how to set up Nginx on EC2s as a reverse proxy and use mutual TLS as the authentication mechanism

## Why Mutual TLS Authentication?

Mutual TLS authentication means both client and server validate the identity of each other by looking at the certificate they present, it is normally used as an authentication method for internal applications that do *** NOT *** have a lot of users.

## Why self-hosted Nginx instead of API gateway / ALB ?

While [Application Load Balancer](https://aws.amazon.com/elasticloadbalancing/application-load-balancer/?nc=sn&loc=2&dn=2) supports many authentication methods like SAML, OpenID Connect and Cognito, it currently does not offer client-side certificate authentication.

On the other hand, API Gateway [recently announced suport for MTLS](https://aws.amazon.com/blogs/compute/introducing-mutual-tls-authentication-for-amazon-api-gateway/). However, API Gateway has inherent limits like 30-second timeout, max payload size limit, etc.

For a more flexible way to enforce two-way certificate-based authentication, we can set up Nginx on EC2 as reverse proxy, in front of our private APIs, and this is what I will show you.

## Getting started
### Pre-requisite
- an cdk-bootsrapped AWS account
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- [AWS CDK tool](https://docs.aws.amazon.com/cdk/latest/guide/cli.html)
- Preferably a Mac/Linux working environment (Check out [Cloud9](https://aws.amazon.com/cloud9/) if you need one, it also comes with the above tools installed by default)

### Preparation
Please kindly clone this repo to follow along
* `git clone`

This repository contains some sample CDK code in typescript, to set up an environment like this:
<img src=doc/high.png ></img>

We will have an EC2 auto-scaling group running Nginx in a load-balanced private subnet, and a private API sitting in private subnets via VPC interface endpoints (to make sure only our EC2s have access to the API)

Later on you can add your domain to <em>Route 53</em> and make an alias record pointing to the NLB, after the environment has been set up

## Setting up the environment
Open the file `lib/nlb-mtls-stack.ts`, here is the code for our demo environment, we cretae an S3 bucket solely for deployment purpose later on, and a VPC with 6 subnets (2 Public 4 Private), an auto-scaling group of 2 EC2 instances and a private API with interface endpoints

Now run `npm run build` and `cdk deploy` to deploy our demo environment

After the deployment completes, you should see the following output:
- the endpoint for the private API ***(only accessible within your VPC!!!)***
- the S3 bucket name for staging our certs and files ***(note the name as we will use that later)***
- the public dns name of your NLB

Run `export S3_BUCKET_NAME=your_bucket_name_here` save your S3 bucket name in a variable for later use

## Setting up domain (Optional)
I will be using my domain and use Route 53 as name server, you can use your own domain or use the default NLB domain name to follow along, though I have not tested if it works using the default NLB domain name.

Go to Route 53 console, create a public hosted zone for your domain:
<img src=doc/r53-1.png> </img>
Other settings can be left as default

Next, add the NS records of your R53 hosted zone to your domain registry
Then we can create an alias record pointing to our NLB:
<img src=doc/r53-alias.png> </img>

## Signing certs for our server and client
We are self-signing our certs here, but in production settings you should either use [AWS Certificate Manager Private CA](https://aws.amazon.com/certificate-manager/private-certificate-authority/?nc=sn&loc=6) or host your own PKI inside hardened private network ***(not really recommended considering the hassle, but you can check out CloudFlare's [open-source PKI](https://github.com/cloudflare/cfssl) for implementation)***

Regardless of which domain you use, export it to a variable:
`export DOMAIN_NAME=your_domain_here`

Inside the `local` directory, we have a file `sign-cert.sh`, it contains the commands required to sign certificates for our CA, server and clients, run them one by one.

> Make sure you have openssl installed

> You can change the parameters if you like

## Setting up Nginx for MTLS

We got our certs already, and now we need to set up Nginx to use MTLS for the internal API
In the `ec2` folder, we have the `nginx.conf` file which is almost complete, only pending our domain name and private API endpoint.

- Note the port 80 listner, we display the `noauth.html` for anyone accessing our ec2 via http, which is nothing more than telling our clients `Accessed Denied`
- For the port 443 listener, we display the `index.html` to our users telling them they have successfully authenticated, in fact they only see this page if they possess the valid client cert, otherwise Nginx will block the request
- Note the `/api` endpoint, it will proxy to our private API, which is basically a hello world lambda (see the code in `lambda/index.ts`)

*** What you need to do: ***
1. Locate the directive `server_name` directive in `nginx.conf`, and set the domain to the value of domain you set for $DOMAIN_NAME
2. Locate the directive `proxy_pass` directive in the `/api` section in `nginx.conf`, and change the value to the private API endpoint (Refer to the CDK stack output if you forgot it)

After you finish the configuration, run the commands in `local/upload.sh` to upload the bundled zip file to our S3 staging bucket

## Setting up our EC2 instances as Nginx

We will use [AWS Systems Manager](https://aws.amazon.com/systems-manager/) to run commands that set up our EC2 as Nginx reverse proxies, this way we don't need to have a bastion in public subnet that is only used as gateway but nothing else.

In our CDK stack, we have already created the EC2 role for Systems Manager, so we can run our commands right away.

Go to [Systems Manager Console](https://us-west-2.console.aws.amazon.com/systems-manager/home?region=us-west-2#), we will use *** Run Command *** for this task

1. Open 'local/deploy.sh', here is the script we will run on each of our EC2
2. Before we run it, *** make sure you replace the S3 bucket name with the one in the CDK output ***
3. Upload the script to our S3 staging bucket with this command: `aws s3 cp local/deploy.sh s3://$S3_BUCKET_NAME/deploy.sh`
4. Run `echo "https://s3.amazonaws.com/$S3_BUCKET_NAME/deploy.sh"` and copy the value, we will use that in a moment
5. For <em>'Command Document'</em>, search for *** AWS-RunRemoteScript ***
6. Select *** S3 *** for <em>"Source Type"</em>
7. For <em>"Source Info"</em>, enter this:
    {"path": "&lt;paste_your_value_copied_above&gt;"}
8. Enter `sudo deploy.sh` for <em>"Command Line</em>
9. For <em>"Targets"</em>, choose instances manually and select all instances
10. Confirm and select <em>"Run Command"</em>

> Don't panic if it doesn't work, we can always use <em>Session Manager</em> to manually run the commands on the EC2s one by one

Now if we check our Load Balancer Target Group, we should see both the port 80 and port 443 target group as "Healthy" after a while

## Testing our endpoint

Now the Nginx are ready and we can test our API

### Testing our page without using TLS on both side
* `curl http://$DOMAIN_NAME`

You should see exactly the output of `ec2/noauth.html`

### Testing our page without client cert
* `curl https://$DOMAIN_NAME --cacert local/ca/ca.crt`

You should see an error message saying "No required SSL certificate was sent"

### Testing our page with MTLS
* `curl https://$DOMAIN_NAME --cacert local/ca/ca.crt --cert local/client/user.crt --key local/client/user.key`

You should see exactly the page in `ec2/index.html`

### Testing our private API with MTLS
* `curl https://$DOMAIN_NAME/api --cacert local/ca/ca.crt --cert local/client/user.crt --key local/client/user.key`

You should see the message `{"message":"Hello from private lambda"}`

## Cleanup

Go to [CloudFormation console](https://us-west-2.console.aws.amazon.com/cloudformation/home?region=us-west-2#/stacks?filteringText=&filteringStatus=active&viewNested=true&hideStacks=true) and delete the stack

