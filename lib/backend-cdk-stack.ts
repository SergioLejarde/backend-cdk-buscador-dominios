import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export class BackendCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. VPC mínima optimizada para RDS y Lambda
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // ⚠️ Paso nuevo: VPC endpoint para Secrets Manager
    vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // 2. Credenciales de la base de datos (guardadas en Secrets Manager)
    const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgres' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    const dbCredentials = rds.Credentials.fromSecret(dbSecret);

    // 3. Instancia RDS PostgreSQL elegible para Free Tier
    const dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      multiAz: false,
      allocatedStorage: 20,
      storageEncrypted: true,
      publiclyAccessible: false,
      credentials: dbCredentials,
      databaseName: 'dominiosdb',
    });

    // 4. Lambda para consultar dominios maliciosos
    const lambdaFunction = new lambda.Function(this, 'CheckDomainFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'checkDomain.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda')),
      vpc,
      environment: {
        SECRET_NAME: dbSecret.secretName,
      },
    });

    // 5. Permitir que la Lambda lea los secretos
    dbSecret.grantRead(lambdaFunction);

    // 6. Permitir que la Lambda acceda al RDS
    dbInstance.connections.allowFrom(lambdaFunction, ec2.Port.tcp(5432));
  }
}
