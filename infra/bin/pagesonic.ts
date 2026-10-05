#!/usr/bin/env node
import 'source-map-support/register'
import { App, Environment } from 'aws-cdk-lib'
import { PagesonicSiteStack } from '../lib/static-site-stack'

const app = new App()

const siteEnv: Environment = {
  account: process.env.SITE_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.SITE_REGION ?? process.env.CDK_DEFAULT_REGION,
}

new PagesonicSiteStack(app, 'PagesonicSiteStack', {
  env: siteEnv,
  domainName: app.node.tryGetContext('domainName') as string | undefined,
  certificateArn: app.node.tryGetContext('certificateArn') as string | undefined,
})
