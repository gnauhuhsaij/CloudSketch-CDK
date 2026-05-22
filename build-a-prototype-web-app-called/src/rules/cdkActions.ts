import type { AwsResourceType } from '../types';

export type ConnectionType = 'permission' | 'trigger' | 'integration' | 'network';

export type CdkActionOption = {
  value: string;
  label: string;
  connectionTypes: ConnectionType[];
  command: string;
  description: string;
};

const actionsByPair: Partial<Record<`${AwsResourceType}->${AwsResourceType}`, CdkActionOption[]>> = {
  'webClient->s3': [
    {
      value: 'presignedPutUrlFlow',
      label: 'presigned PUT URL flow',
      connectionTypes: ['permission'],
      command: 'browser -> API Gateway -> Lambda creates getSignedUrl(PutObjectCommand); browser PUTs directly to S3',
      description: 'Use this when the browser should upload files directly to S3 without AWS credentials.',
    },
    {
      value: 'bucketCorsPut',
      label: 'bucket CORS PUT rule',
      connectionTypes: ['permission'],
      command: 'bucket.addCorsRule({ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [origin], allowedHeaders: ["*"] })',
      description: 'Allow the browser origin to send presigned PUT requests to the bucket.',
    },
  ],
  'apiGateway->lambda': [
    {
      value: 'lambdaIntegration',
      label: 'LambdaIntegration',
      connectionTypes: ['integration'],
      command: 'new apigateway.LambdaIntegration(lambdaFn)',
      description: 'Route API Gateway requests to this Lambda function.',
    },
    {
      value: 'addMethodLambdaIntegration',
      label: 'addMethod + LambdaIntegration',
      connectionTypes: ['integration'],
      command: "resource.addMethod('POST', new apigateway.LambdaIntegration(lambdaFn))",
      description: 'Create a specific route method and attach the Lambda integration.',
    },
    {
      value: 'addProxyLambdaIntegration',
      label: 'addProxy defaultIntegration',
      connectionTypes: ['integration'],
      command: 'resource.addProxy({ defaultIntegration: new apigateway.LambdaIntegration(lambdaFn), anyMethod: true })',
      description: 'Create a greedy proxy route that forwards matching methods to Lambda.',
    },
    {
      value: 'restApiDefaultIntegration',
      label: 'RestApi defaultIntegration',
      connectionTypes: ['integration'],
      command: 'new apigateway.RestApi(this, id, { defaultIntegration: new apigateway.LambdaIntegration(lambdaFn) })',
      description: 'Route API methods without an explicit integration to this Lambda.',
    },
    {
      value: 'lambdaInvokePermission',
      label: 'Lambda invoke permission',
      connectionTypes: ['permission'],
      command: "lambdaFn.addPermission('AllowApiGatewayInvoke', { principal: new iam.ServicePrincipal('apigateway.amazonaws.com'), sourceArn: api.arnForExecuteApi() })",
      description: 'Explicitly allow API Gateway to invoke this Lambda when not using a higher-level integration helper.',
    },
    {
      value: 'executeApiInvokePolicy',
      label: 'execute-api invoke policy',
      connectionTypes: ['permission'],
      command: "principal.addToPolicy(new iam.PolicyStatement({ actions: ['execute-api:Invoke'], resources: [method.methodArn] }))",
      description: 'Grant a caller permission to invoke an IAM-authorized API Gateway method.',
    },
  ],
  'lambda->s3': [
    {
      value: 'grantPut',
      label: 'grantPut',
      connectionTypes: ['permission'],
      command: 'bucket.grantPut(lambdaFn)',
      description: 'Allow Lambda to upload objects or create presigned PUT URLs.',
    },
    {
      value: 'grantReadWrite',
      label: 'grantReadWrite',
      connectionTypes: ['permission'],
      command: 'bucket.grantReadWrite(lambdaFn)',
      description: 'Allow Lambda to read and write bucket objects.',
    },
    {
      value: 'grantRead',
      label: 'grantRead',
      connectionTypes: ['permission'],
      command: 'bucket.grantRead(lambdaFn)',
      description: 'Allow Lambda to read bucket objects only.',
    },
    {
      value: 'grantDelete',
      label: 'grantDelete',
      connectionTypes: ['permission'],
      command: 'bucket.grantDelete(lambdaFn)',
      description: 'Allow Lambda to delete bucket objects.',
    },
    {
      value: 'grantWrite',
      label: 'grantWrite',
      connectionTypes: ['permission'],
      command: 'bucket.grantWrite(lambdaFn)',
      description: 'Allow Lambda to write bucket objects.',
    },
  ],
  'lambda->dynamodb': [
    {
      value: 'grantReadWriteData',
      label: 'grantReadWriteData',
      connectionTypes: ['permission'],
      command: 'table.grantReadWriteData(lambdaFn)',
      description: 'Allow Lambda to read and write DynamoDB table items.',
    },
    {
      value: 'grantWriteData',
      label: 'grantWriteData',
      connectionTypes: ['permission'],
      command: 'table.grantWriteData(lambdaFn)',
      description: 'Allow Lambda to create or update DynamoDB table items.',
    },
    {
      value: 'grantReadData',
      label: 'grantReadData',
      connectionTypes: ['permission'],
      command: 'table.grantReadData(lambdaFn)',
      description: 'Allow Lambda to read DynamoDB table items.',
    },
    {
      value: 'grantFullAccess',
      label: 'grantFullAccess',
      connectionTypes: ['permission'],
      command: 'table.grantFullAccess(lambdaFn)',
      description: 'Allow Lambda all DynamoDB actions on this table. Use sparingly.',
    },
  ],
  'dynamodb->lambda': [
    {
      value: 'dynamoEventSource',
      label: 'DynamoEventSource',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new lambdaEventSources.DynamoEventSource(table, ...))',
      description: 'Trigger Lambda from DynamoDB Streams.',
    },
    {
      value: 'dynamoEventSourceWithBatch',
      label: 'DynamoEventSource + batch',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new DynamoEventSource(table, { batchSize, startingPosition }))',
      description: 'Trigger Lambda from DynamoDB Streams with batching controls.',
    },
    {
      value: 'dynamoEventSourceWithFilter',
      label: 'DynamoEventSource + filters',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new DynamoEventSource(table, { filters: [...] }))',
      description: 'Trigger Lambda only for matching DynamoDB stream records.',
    },
  ],
  'lambda->ec2': [
    {
      value: 'runInstancesPolicy',
      label: 'RunInstances policy',
      connectionTypes: ['permission'],
      command: 'lambdaFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["ec2:RunInstances", "iam:PassRole"], ... }))',
      description: 'Allow Lambda to launch EC2 with an instance profile.',
    },
    {
      value: 'passRolePolicy',
      label: 'PassRole policy',
      connectionTypes: ['permission'],
      command: "lambdaFn.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [role.roleArn] }))",
      description: 'Allow Lambda to pass the EC2 instance profile role.',
    },
    {
      value: 'ssmAmiLookup',
      label: 'SSM AMI lookup',
      connectionTypes: ['integration'],
      command: "ssm.StringParameter.valueForStringParameter(this, '/aws/service/ami-amazon-linux-latest/...')",
      description: 'Resolve the latest Amazon Linux AMI for dynamic instance launches.',
    },
  ],
  'ec2->s3': [
    {
      value: 'grantReadWriteToInstanceRole',
      label: 'grantReadWrite to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantReadWrite(instanceRole)',
      description: 'Allow the VM role to download input and upload output.',
    },
    {
      value: 'grantReadToInstanceRole',
      label: 'grantRead to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantRead(instanceRole)',
      description: 'Allow the VM role to download input or scripts.',
    },
    {
      value: 'grantPutToInstanceRole',
      label: 'grantPut to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantPut(instanceRole)',
      description: 'Allow the VM role to upload output files.',
    },
    {
      value: 'grantWriteToInstanceRole',
      label: 'grantWrite to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantWrite(instanceRole)',
      description: 'Allow the VM role to write objects to the bucket.',
    },
  ],
  'ec2->dynamodb': [
    {
      value: 'grantReadWriteDataToInstanceRole',
      label: 'grantReadWriteData to role',
      connectionTypes: ['permission'],
      command: 'table.grantReadWriteData(instanceRole)',
      description: 'Allow the VM role to read job input and update output metadata.',
    },
    {
      value: 'grantReadDataToInstanceRole',
      label: 'grantReadData to role',
      connectionTypes: ['permission'],
      command: 'table.grantReadData(instanceRole)',
      description: 'Allow the VM role to read job input from DynamoDB.',
    },
    {
      value: 'grantWriteDataToInstanceRole',
      label: 'grantWriteData to role',
      connectionTypes: ['permission'],
      command: 'table.grantWriteData(instanceRole)',
      description: 'Allow the VM role to write output metadata to DynamoDB.',
    },
  ],
  'sqs->lambda': [
    {
      value: 'sqsEventSource',
      label: 'SqsEventSource',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new lambdaEventSources.SqsEventSource(queue))',
      description: 'Trigger Lambda from SQS messages.',
    },
    {
      value: 'sqsEventSourceWithBatch',
      label: 'SqsEventSource + batch',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new SqsEventSource(queue, { batchSize, maxBatchingWindow }))',
      description: 'Trigger Lambda from SQS with batch/window tuning.',
    },
    {
      value: 'sqsEventSourceWithFailures',
      label: 'SqsEventSource + failures',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new SqsEventSource(queue, { reportBatchItemFailures: true }))',
      description: 'Enable partial batch failure reporting for SQS processing.',
    },
  ],
  's3->lambda': [
    {
      value: 's3EventNotification',
      label: 'S3 event notification',
      connectionTypes: ['trigger'],
      command: 'bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(lambdaFn))',
      description: 'Trigger Lambda when matching S3 events occur.',
    },
    {
      value: 's3EventSource',
      label: 'S3EventSource',
      connectionTypes: ['trigger'],
      command: 'lambdaFn.addEventSource(new lambdaEventSources.S3EventSource(bucket, { events: [...] }))',
      description: 'Attach S3 bucket events to Lambda using the lambda-event-sources helper.',
    },
    {
      value: 's3EventSourceWithFilter',
      label: 'S3EventSource + filters',
      connectionTypes: ['trigger'],
      command: "lambdaFn.addEventSource(new S3EventSource(bucket, { events: [...], filters: [{ prefix: 'input/' }] }))",
      description: 'Trigger Lambda only for S3 events matching key prefix/suffix filters.',
    },
  ],
  'iamRole->ec2': [
    {
      value: 'instanceProfile',
      label: 'InstanceProfile',
      connectionTypes: ['permission'],
      command: 'new iam.InstanceProfile(this, "Profile", { role })',
      description: 'Attach this IAM role to EC2 through an instance profile.',
    },
    {
      value: 'passRoleTarget',
      label: 'PassRole target',
      connectionTypes: ['permission'],
      command: 'launcherLambda.addToRolePolicy(new iam.PolicyStatement({ actions: ["iam:PassRole"], resources: [role.roleArn] }))',
      description: 'Allow a launcher Lambda to pass this EC2 role when creating the instance.',
    },
  ],
  'iamRole->s3': [
    {
      value: 'grantReadWriteToRole',
      label: 'grantReadWrite to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantReadWrite(role)',
      description: 'Allow anything using this role, such as the attached EC2 VM, to read and write bucket objects.',
    },
    {
      value: 'grantReadToRole',
      label: 'grantRead to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantRead(role)',
      description: 'Allow anything using this role to download bucket objects.',
    },
    {
      value: 'grantPutToRole',
      label: 'grantPut to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantPut(role)',
      description: 'Allow anything using this role to upload bucket objects.',
    },
    {
      value: 'grantWriteToRole',
      label: 'grantWrite to role',
      connectionTypes: ['permission'],
      command: 'bucket.grantWrite(role)',
      description: 'Allow anything using this role to write bucket objects.',
    },
  ],
  'iamRole->dynamodb': [
    {
      value: 'grantReadWriteDataToRole',
      label: 'grantReadWriteData to role',
      connectionTypes: ['permission'],
      command: 'table.grantReadWriteData(role)',
      description: 'Allow anything using this role, such as the attached EC2 VM, to read and write table items.',
    },
    {
      value: 'grantReadDataToRole',
      label: 'grantReadData to role',
      connectionTypes: ['permission'],
      command: 'table.grantReadData(role)',
      description: 'Allow anything using this role to read table items.',
    },
    {
      value: 'grantWriteDataToRole',
      label: 'grantWriteData to role',
      connectionTypes: ['permission'],
      command: 'table.grantWriteData(role)',
      description: 'Allow anything using this role to write table items.',
    },
  ],
  'scriptAsset->s3': [
    {
      value: 'bucketDeployment',
      label: 'BucketDeployment',
      connectionTypes: ['integration'],
      command: 'new s3deploy.BucketDeployment(this, "DeployScript", { sources: [s3deploy.Source.asset("scripts")], destinationBucket: bucket })',
      description: 'Upload local script files to the bucket during CDK deployment.',
    },
    {
      value: 'assetUploadNote',
      label: 'external asset upload',
      connectionTypes: ['integration'],
      command: 'Upload script asset with CI/CD or a custom deployment step, then store the S3 key in VM user data.',
      description: 'Use this when script upload is handled outside of CDK.',
    },
  ],
};

export function getCdkActionOptions(sourceType?: AwsResourceType, targetType?: AwsResourceType, connectionType?: string) {
  if (!sourceType || !targetType) return [];
  const options = actionsByPair[`${sourceType}->${targetType}`] || [];
  if (!connectionType) return options;
  return options.filter((option) => option.connectionTypes.includes(connectionType as ConnectionType));
}

export function getDefaultCdkAction(sourceType?: AwsResourceType, targetType?: AwsResourceType, connectionType?: string) {
  return getCdkActionOptions(sourceType, targetType, connectionType)[0]?.value;
}

export function getCdkActionOption(sourceType?: AwsResourceType, targetType?: AwsResourceType, connectionType?: string, value?: string) {
  const options = getCdkActionOptions(sourceType, targetType, connectionType);
  return options.find((option) => option.value === value) || options[0];
}
