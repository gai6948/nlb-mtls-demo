#!/bin/bash
sudo yum install -y nginx unzip
export S3_BUCKET_NAME=your_s3_bucket_here
sudo aws s3 cp s3://$S3_BUCKET_NAME/package.zip package.zip
sudo unzip package.zip
sudo mkdir -p /etc/nginx/certs/ca
sudo mkdir -p /etc/nginx/certs/server
sudo mv ec2/server.crt /etc/nginx/certs/server/server.crt
sudo mv ec2/server.key /etc/nginx/certs/server/server.key
sudo mv ec2/ca.crt /etc/nginx/certs/ca/ca.crt
sudo chmod 444 /etc/nginx/certs/server/server.crt
sudo chmod 444 /etc/nginx/certs/server/server.key
sudo chmod 444 /etc/nginx/certs/ca/ca.crt
sudo mv ec2/nginx.conf /etc/nginx/nginx.conf
sudo chmod 444 /etc/nginx/nginx.conf
sudo mkdir -p /usr/share/nginx/mssl
sudo mv ec2/index.html /usr/share/nginx/mssl/index.html
sudo mv ec2/noauth.html /usr/share/nginx/mssl/noauth.html
sudo service nginx start
sudo chkconfig nginx on
sudo iptables -A INPUT -p tcp --dport 443 -m state --state NEW,ESTABLISHED -j ACCEPT
sudo iptables -A OUTPUT -p tcp --sport 443 -m state --state ESTABLISHED -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -m state --state NEW,ESTABLISHED -j ACCEPT
sudo iptables -A OUTPUT -p tcp --sport 80 -m state --state ESTABLISHED -j ACCEPT
sudo service iptables restart
