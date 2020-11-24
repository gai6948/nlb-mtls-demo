#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { NLBNginxStack } from '../lib/nlb-mtls-stack';

const app = new cdk.App();
new NLBNginxStack(app, 'NlbMtlsStack');

app.synth();
