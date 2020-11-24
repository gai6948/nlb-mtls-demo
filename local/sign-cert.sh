#!/bin/bash
# Generate CA cert
mkdir -p local/ca
openssl genrsa -out local/ca/ca.key 4096
openssl req -new -x509 -days 3650 -key local/ca/ca.key -out local/ca/ca.crt -subj "/C=US/ST=SF/L=SanFrancisco/O=CertAuth/OU=IT/CN=RootCA"
chmod 444 local/ca/ca.crt
# Sign client cert
mkdir -p local/client
openssl genrsa -out local/client/user.key 2048
openssl req -new -key local/client/user.key -out local/client/user.csr -subj "/C=US/ST=SF/L=SanFrancisco/O=User/OU=IT/CN=User/"
openssl x509 -req -days 365 -in local/client/user.csr -CA local/ca/ca.crt -CAkey local/ca/ca.key -set_serial 01 -out local/client/user.crt
openssl verify -verbose -CAfile local/ca/ca.crt local/client/user.crt
# Sign server cert
mkdir -p local/server
openssl genrsa -out local/server/server.key 2048
openssl req -new -key local/server/server.key -out local/server/server.csr -subj "/C=US/ST=SF/L=SanFrancisco/O=Server/OU=IT/CN=$DOMAIN_NAME"
openssl x509 -req -days 365 -sha256 -in local/server/server.csr -CA local/ca/ca.crt -CAkey local/ca/ca.key -set_serial 1 -out local/server/server.crt
openssl verify -verbose -CAfile local/ca/ca.crt local/server/server.crt
