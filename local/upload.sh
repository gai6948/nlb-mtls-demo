#!/bin/bash
# Bundle cert and deployment package for EC2 bootstrapping
cp local/ca/ca.crt ec2/ca.crt
cp local/server/server.key ec2/server.key
cp local/server/server.crt ec2/server.crt
zip ec2/package.zip ec2/*
# Upload package to s3 bucket
aws s3 cp ec2/package.zip s3://$S3_BUCKET_NAME/package.zip
