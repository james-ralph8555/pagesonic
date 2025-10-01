import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  CfnOutput,
} from 'aws-cdk-lib'
import { Construct } from 'constructs'
import path from 'path'
import { existsSync } from 'fs'
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
} from 'aws-cdk-lib/aws-s3'
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront'
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment'
import {
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  Distribution,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
  BehaviorOptions,
  ErrorResponse,
} from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'

export class PagesonicSiteStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props)

    // Resolve deployment source path for the site assets
    // - default: repo root `dist/`
    // - override: `-c distPath=/abs/path` when invoking CDK
    const contextDist = this.node.tryGetContext('distPath') as string | undefined
    const distPath = contextDist ?? path.resolve(__dirname, '../../dist')

    if (!existsSync(distPath)) {
      throw new Error(`Build artifacts not found at: ${distPath}. Run 'npm run build' from repo root or pass '-c distPath=/abs/path'.`)
    }

    const siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    })

    const originAccessIdentity = new OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: 'Access identity for the Pagesonic static site bucket',
    })

    const responseHeadersPolicy = new ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
            override: true,
          },
          {
            header: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
            override: true,
          },
        ],
      },
    })

    const originPolicy = new OriginRequestPolicy(this, 'OriginRequestPolicy', {
      cookieBehavior: OriginRequestCookieBehavior.none(),
      headerBehavior: OriginRequestHeaderBehavior.none(),
      queryStringBehavior: OriginRequestQueryStringBehavior.none(),
    })

    const defaultBehavior: BehaviorOptions = {
      origin: S3BucketOrigin.withOriginAccessIdentity(siteBucket, {
        originAccessIdentity,
      }),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      originRequestPolicy: originPolicy,
      responseHeadersPolicy,
      compress: true,
    }

    const errorResponses: ErrorResponse[] = [
      {
        httpStatus: 403,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(5),
      },
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.minutes(5),
      },
    ]

    const distribution = new Distribution(this, 'SiteDistribution', {
      defaultBehavior,
      defaultRootObject: 'index.html',
      comment: 'Pagesonic SolidJS site distribution',
      errorResponses,
    })

    new BucketDeployment(this, 'DeployWithInvalidation', {
      sources: [Source.asset(distPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [
        CacheControl.fromString('public, max-age=0, must-revalidate'),
      ],
      prune: true,
      // Large model assets can make uploads slow; give the
      // custom resource more resources and time to finish.
      memoryLimit: 2048,
      timeout: Duration.minutes(30),
    })

    new CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
    })

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
    })

    new CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.domainName,
    })
  }
}
