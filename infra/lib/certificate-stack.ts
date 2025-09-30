import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface PagesonicCertificateStackProps extends StackProps {
  domainName: string;
}

export class PagesonicCertificateStack extends Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: PagesonicCertificateStackProps) {
    super(scope, id, props);

    const { domainName } = props;

    this.certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName,
      subjectAlternativeNames: [`www.${domainName}`],
      validation: acm.CertificateValidation.fromDns(),
    });

    new CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      description: 'ARN of the ACM certificate (us-east-1)',
      exportName: 'PagesonicCertificateArn',
    });
  }
}
