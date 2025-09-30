import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib'
import { DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { HostedZone } from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'

export interface PagesonicCertificateStackProps extends StackProps {
  readonly domainName?: string
  readonly hostedZoneId?: string
  readonly hostedZoneName?: string
  readonly alternativeNames?: string[]
}

export class PagesonicCertificateStack extends Stack {
  readonly certificateArn?: string

  constructor(scope: Construct, id: string, props: PagesonicCertificateStackProps = {}) {
    super(scope, id, props)

    const { domainName, hostedZoneId, hostedZoneName, alternativeNames } = props

    if (!domainName || !hostedZoneId || !hostedZoneName) {
      new CfnOutput(this, 'CertificateSetupInstructions', {
        value:
          'Provide context values for certificateDomain, certificateHostedZoneId, and certificateHostedZoneName to create the ACM certificate.',
      })
      return
    }

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      hostedZoneId,
      zoneName: hostedZoneName,
    })

    const certificate = new DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      subjectAlternativeNames: alternativeNames,
      hostedZone,
      region: 'us-east-1',
    })

    this.certificateArn = certificate.certificateArn

    new CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
      exportName: `${this.stackName}-CertificateArn`,
    })
  }
}
