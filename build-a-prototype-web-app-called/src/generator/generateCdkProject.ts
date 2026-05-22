import { findRule } from '../rules/awsRules';
import { getCdkActionOption } from '../rules/cdkActions';
import type { AwsResourceType, GraphModel } from '../types';

type UsedImports = {
  lambda?: boolean;
  lambdaNodejs?: boolean;
  s3?: boolean;
  s3deploy?: boolean;
  dynamodb?: boolean;
  apigateway?: boolean;
  sqs?: boolean;
  ec2?: boolean;
  events?: boolean;
  targets?: boolean;
  s3n?: boolean;
  lambdaEventSources?: boolean;
  iam?: boolean;
  ssm?: boolean;
  path?: boolean;
};

function toPascal(value: string) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toCamel(value: string) {
  const pascal = toPascal(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function literal(value: unknown) {
  if (value === 'true') return 'true';
  if (value === 'false') return 'false';
  if (typeof value === 'number') return String(value);
  if (value === '') return "''";
  return JSON.stringify(value);
}

function lambdaRuntime(value: unknown) {
  const runtimes: Record<string, string> = {
    'nodejs20.x': 'NODEJS_20_X',
    'python3.12': 'PYTHON_3_12',
    java21: 'JAVA_21',
  };
  return runtimes[String(value)] || 'NODEJS_20_X';
}

function stringList(value: unknown, fallback: string[] = []) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function apiResourceExpression(apiRef: string, routePath: unknown) {
  const pathParts = String(routePath || '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  return pathParts.reduce((expr, part) => `${expr}.addResource(${literal(part)})`, `${apiRef}.root`);
}

function synthesizeResource(node: GraphModel['nodes'][number], imports: UsedImports) {
  const id = toPascal(node.name || node.type);
  const ref = toCamel(node.name || node.type);
  const config = node.config;

  const linesByType: Record<AwsResourceType, string[]> = {
    webClient: [
      `// Web client origin: ${config.origin || 'http://localhost:5173'}`,
      `// Browser flow: call API Gateway for presigned URLs and metadata, then PUT files directly to S3.`,
    ],
    lambda: [
      `const ${ref} = new lambdaNodejs.NodejsFunction(this, '${id}', {`,
      `  runtime: lambda.Runtime.${lambdaRuntime(config.runtime || 'nodejs20.x')},`,
      `  handler: ${literal(config.handler || 'handler')},`,
      `  entry: path.join(__dirname, '../${config.entry || 'lambdas/handler/index.ts'}'),`,
      `  memorySize: ${Number(config.memorySize || 128)},`,
      `  environment: {`,
      `    // Add BUCKET_NAME, TABLE_NAME, profileName, or ImageID based on connected resources.`,
      `  },`,
      `});`,
    ],
    s3: [
      `const ${ref} = new s3.Bucket(this, '${id}', {`,
      `  versioned: ${config.versioned === 'true'},`,
      `  removalPolicy: cdk.RemovalPolicy.${config.removalPolicy || 'DESTROY'},`,
      `  autoDeleteObjects: ${config.removalPolicy !== 'RETAIN'},`,
      `});`,
      ...stringList(config.corsOrigins).map(
        (origin) =>
          `${ref}.addCorsRule({ allowedMethods: [s3.HttpMethods.PUT], allowedOrigins: [${literal(origin)}], allowedHeaders: ['*'] });`,
      ),
    ],
    dynamodb: [
      `const ${ref} = new dynamodb.Table(this, '${id}', {`,
      `  partitionKey: { name: ${literal(config.partitionKey || 'id')}, type: dynamodb.AttributeType.STRING },`,
      `  billingMode: dynamodb.BillingMode.${config.billingMode || 'PAY_PER_REQUEST'},`,
      config.stream === 'DISABLED' ? '' : `  stream: dynamodb.StreamViewType.${config.stream || 'NEW_IMAGE'},`,
      `  removalPolicy: cdk.RemovalPolicy.DESTROY,`,
      `});`,
    ].filter(Boolean),
    apiGateway: [
      `const ${ref} = new apigateway.RestApi(this, '${id}', {`,
      `  deployOptions: { stageName: ${literal(config.stageName || 'prod')} },`,
      `  defaultCorsPreflightOptions: {`,
      `    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],`,
      `    allowHeaders: ['Content-Type'],`,
      `    allowOrigins: [${stringList(config.corsOrigins, ['*']).map(literal).join(', ')}],`,
      `  },`,
      `});`,
    ],
    sqs: [
      `const ${ref} = new sqs.Queue(this, '${id}', {`,
      `  visibilityTimeout: cdk.Duration.seconds(${Number(config.visibilityTimeout || 30)}),`,
      `  retentionPeriod: cdk.Duration.days(${Number(config.retentionDays || 4)}),`,
      `});`,
    ],
    ec2: [
      config.launchMode === 'dynamic'
        ? `// ${node.name} is a dynamic VM launched by Lambda at runtime.`
        : `const ${ref}Vpc = new ec2.Vpc(this, '${id}Vpc', { maxAzs: 2 });`,
      config.launchMode === 'dynamic'
        ? `// AMI lookup hint: ssm.StringParameter.valueForStringParameter(this, '/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-default-x86_64')`
        : `const ${ref} = new ec2.Instance(this, '${id}', {`,
      config.launchMode === 'dynamic' ? `// Instance type hint: ${config.instanceType || 't3.micro'}` : `  vpc: ${ref}Vpc,`,
      config.launchMode === 'dynamic'
        ? `// Auto terminate after script completes: ${config.autoTerminate || 'true'}`
        : `  instanceType: new ec2.InstanceType(${literal(config.instanceType || 't3.micro')}),`,
      config.launchMode === 'dynamic' ? `` : `  machineImage: ec2.MachineImage.latestAmazonLinux2023(),`,
      config.launchMode === 'dynamic' ? `` : `});`,
    ].filter(Boolean),
    eventBridge: [
      `const ${ref} = new events.Rule(this, '${id}', {`,
      `  schedule: events.Schedule.expression(${literal(config.schedule || 'rate(5 minutes)')}),`,
      `});`,
    ],
    iamRole: [
      `const ${ref} = new iam.Role(this, '${id}', {`,
      `  assumedBy: new iam.ServicePrincipal(${literal(config.assumedBy || 'ec2.amazonaws.com')}),`,
      `});`,
      config.includeInstanceProfile === 'true'
        ? `const ${ref}Profile = new iam.InstanceProfile(this, '${id}Profile', { role: ${ref} });`
        : `// Instance profile disabled for ${node.name}.`,
    ],
    scriptAsset: [
      `// Script asset ${node.name}: ${config.localPath || 'scripts/process-input.sh'}`,
      `// Upload to S3 key ${config.s3Key || 'scripts/process-input.sh'} using s3deploy.BucketDeployment or your deployment pipeline.`,
    ],
  };

  const importKeyByType: Record<AwsResourceType, keyof UsedImports> = {
    webClient: 'apigateway',
    lambda: 'lambda',
    s3: 's3',
    dynamodb: 'dynamodb',
    apiGateway: 'apigateway',
    sqs: 'sqs',
    ec2: 'ec2',
    eventBridge: 'events',
    iamRole: 'iam',
    scriptAsset: 's3deploy',
  };
  imports[importKeyByType[node.type]] = true;

  if (node.type === 'lambda') {
    imports.lambdaNodejs = true;
    imports.path = true;
  }
  if (node.type === 'ec2' && node.config.launchMode === 'dynamic') {
    imports.ssm = true;
  }

  return { ref, lines: linesByType[node.type] };
}

function synthesizeEdge(
  edge: GraphModel['edges'][number],
  graph: GraphModel,
  refs: Map<string, string>,
  imports: UsedImports,
) {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return `// Skipped ${edge.id}: source or target resource was missing.`;

  const sourceRef = refs.get(source.id);
  const targetRef = refs.get(target.id);
  const rule = findRule(source.type, target.type);
  const selectedAction = getCdkActionOption(source.type, target.type, edge.connectionType, edge.cdkAction);
  if (!sourceRef || !targetRef || !rule) {
    return `// TODO: Review ${source.name} -> ${target.name}. No supported CDK mapping is defined yet.`;
  }

  if (!rule.valid) return `// INVALID: ${rule.message}`;

  if (source.type === 'webClient' && target.type === 'apiGateway') {
    return `// Frontend calls ${targetRef}.url for presigned URL and DynamoDB submit routes.`;
  }
  if (source.type === 'webClient' && target.type === 's3') {
    if (selectedAction?.value === 'bucketCorsPut') return `// ${targetRef}.addCorsRule(...) allows browser PUT requests from the configured frontend origin.`;
    return `// Browser uploads directly to ${targetRef} with a presigned PUT URL; file bytes do not pass through Lambda.`;
  }
  if (source.type === 'apiGateway' && target.type === 'lambda') {
    const route = apiResourceExpression(sourceRef, target.config.apiPath);
    const method = String(target.config.apiMethod || 'POST').toUpperCase();
    return `${route}.addMethod('${method}', new apigateway.LambdaIntegration(${targetRef})); // ${target.name}`;
  }
  if (source.type === 'lambda' && target.type === 's3') {
    if (selectedAction?.value === 'grantPut') return `${targetRef}.grantPut(${sourceRef});`;
    if (selectedAction?.value === 'grantRead') return `${targetRef}.grantRead(${sourceRef});`;
    if (selectedAction?.value === 'grantWrite') return `${targetRef}.grantWrite(${sourceRef});`;
    if (selectedAction?.value === 'grantDelete') return `${targetRef}.grantDelete(${sourceRef});`;
    return `${targetRef}.grantReadWrite(${sourceRef});`;
  }
  if (source.type === 'lambda' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantWriteData') return `${targetRef}.grantWriteData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
    if (selectedAction?.value === 'grantReadData') return `${targetRef}.grantReadData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
    if (selectedAction?.value === 'grantFullAccess') return `${targetRef}.grantFullAccess(${sourceRef}); // Broad permission; narrow before production.`;
    return `${targetRef}.grantReadWriteData(${sourceRef}); // Set TABLE_NAME=${targetRef}.tableName in ${sourceRef}.environment.`;
  }
  if (source.type === 'lambda' && target.type === 'ec2') {
    imports.iam = true;
    imports.ssm = true;
    return `${sourceRef}.addToRolePolicy(new iam.PolicyStatement({ actions: ['ec2:RunInstances', 'iam:PassRole'], resources: ['*'] })); // Dynamic EC2 launcher.`;
  }
  if (source.type === 'lambda' && target.type === 'sqs') return `${targetRef}.grantSendMessages(${sourceRef});`;
  if (source.type === 'dynamodb' && target.type === 'lambda') {
    imports.lambdaEventSources = true;
    return `${targetRef}.addEventSource(new lambdaEventSources.DynamoEventSource(${sourceRef}, { startingPosition: lambda.StartingPosition.LATEST }));`;
  }
  if (source.type === 'sqs' && target.type === 'lambda') {
    imports.lambdaEventSources = true;
    return `${targetRef}.addEventSource(new lambdaEventSources.SqsEventSource(${sourceRef}));`;
  }
  if (source.type === 's3' && target.type === 'lambda') {
    imports.s3n = true;
    return `${sourceRef}.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(${targetRef}));`;
  }
  if (source.type === 'ec2' && target.type === 's3') {
    if (selectedAction?.value === 'grantReadToInstanceRole') return `// ${targetRef}.grantRead(instanceRole); // VM can download input or scripts.`;
    if (selectedAction?.value === 'grantPutToInstanceRole') return `// ${targetRef}.grantPut(instanceRole); // VM can upload output files.`;
    if (selectedAction?.value === 'grantWriteToInstanceRole') return `// ${targetRef}.grantWrite(instanceRole); // VM can write objects.`;
    return `// ${targetRef}.grantReadWrite(instanceRole); // VM can download input and upload output.`;
  }
  if (source.type === 'ec2' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantReadDataToInstanceRole') return `// ${targetRef}.grantReadData(instanceRole); // VM can read job input.`;
    if (selectedAction?.value === 'grantWriteDataToInstanceRole') return `// ${targetRef}.grantWriteData(instanceRole); // VM can write output metadata.`;
    return `// ${targetRef}.grantReadWriteData(instanceRole); // VM can read job input and write output metadata.`;
  }
  if (source.type === 'iamRole' && target.type === 'ec2') {
    if (selectedAction?.value === 'passRoleTarget') return `// Grant launcher Lambda iam:PassRole on ${sourceRef}.roleArn before RunInstances.`;
    return `// Attach ${sourceRef}Profile to dynamic RunInstances calls or to a static ec2.Instance.`;
  }
  if (source.type === 'iamRole' && target.type === 's3') {
    if (selectedAction?.value === 'grantReadToRole') return `${targetRef}.grantRead(${sourceRef});`;
    if (selectedAction?.value === 'grantPutToRole') return `${targetRef}.grantPut(${sourceRef});`;
    if (selectedAction?.value === 'grantWriteToRole') return `${targetRef}.grantWrite(${sourceRef});`;
    return `${targetRef}.grantReadWrite(${sourceRef});`;
  }
  if (source.type === 'iamRole' && target.type === 'dynamodb') {
    if (selectedAction?.value === 'grantReadDataToRole') return `${targetRef}.grantReadData(${sourceRef});`;
    if (selectedAction?.value === 'grantWriteDataToRole') return `${targetRef}.grantWriteData(${sourceRef});`;
    return `${targetRef}.grantReadWriteData(${sourceRef});`;
  }
  if (source.type === 'scriptAsset' && target.type === 's3') {
    imports.s3deploy = true;
    if (selectedAction?.value === 'bucketDeployment') return `// new s3deploy.BucketDeployment(..., { destinationBucket: ${targetRef} });`;
    return `// Upload script asset to ${targetRef}; EC2 user data should download and execute it.`;
  }
  if (source.type === 'eventBridge' && target.type === 'lambda') {
    imports.targets = true;
    return `${sourceRef}.addTarget(new targets.LambdaFunction(${targetRef}));`;
  }
  if (source.type === 'eventBridge' && target.type === 'sqs') {
    imports.targets = true;
    return `${sourceRef}.addTarget(new targets.SqsQueue(${targetRef}));`;
  }

  return `// TODO: Implement ${rule.cdkHint}`;
}

function renderImports(imports: UsedImports) {
  const lines = [`import * as cdk from 'aws-cdk-lib';`, `import { Construct } from 'constructs';`];
  if (imports.lambda) lines.push(`import * as lambda from 'aws-cdk-lib/aws-lambda';`);
  if (imports.lambdaNodejs) lines.push(`import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';`);
  if (imports.s3) lines.push(`import * as s3 from 'aws-cdk-lib/aws-s3';`);
  if (imports.s3deploy) lines.push(`import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';`);
  if (imports.s3n) lines.push(`import * as s3n from 'aws-cdk-lib/aws-s3-notifications';`);
  if (imports.dynamodb) lines.push(`import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';`);
  if (imports.apigateway) lines.push(`import * as apigateway from 'aws-cdk-lib/aws-apigateway';`);
  if (imports.sqs) lines.push(`import * as sqs from 'aws-cdk-lib/aws-sqs';`);
  if (imports.ec2) lines.push(`import * as ec2 from 'aws-cdk-lib/aws-ec2';`);
  if (imports.events) lines.push(`import * as events from 'aws-cdk-lib/aws-events';`);
  if (imports.targets) lines.push(`import * as targets from 'aws-cdk-lib/aws-events-targets';`);
  if (imports.lambdaEventSources) lines.push(`import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';`);
  if (imports.iam) lines.push(`import * as iam from 'aws-cdk-lib/aws-iam';`);
  if (imports.ssm) lines.push(`import * as ssm from 'aws-cdk-lib/aws-ssm';`);
  if (imports.path) lines.push(`import * as path from 'node:path';`);
  return lines.join('\n');
}

export function generateCdkProject(graph: GraphModel): Record<string, string> {
  const imports: UsedImports = {};
  const refs = new Map<string, string>();
  const resourceBlocks = graph.nodes.map((node) => {
    const resource = synthesizeResource(node, imports);
    refs.set(node.id, resource.ref);
    return resource.lines.join('\n');
  });
  const edgeLines = graph.edges.map((edge) => synthesizeEdge(edge, graph, refs, imports));

  const stack = `${renderImports(imports)}

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

${resourceBlocks.length ? resourceBlocks.map((block) => block.replace(/^/gm, '    ')).join('\n\n') : '    // Add resources in InfraCanvas to generate constructs here.'}

${edgeLines.length ? edgeLines.map((line) => `    ${line}`).join('\n') : '    // Connect resources in InfraCanvas to generate permissions, routes, event sources, and IAM hints.'}
  }
}
`;

  return {
    'package.json': JSON.stringify(
      {
        name: 'infracanvas-generated',
        version: '0.1.0',
        private: true,
        scripts: {
          build: 'tsc',
          synth: 'cdk synth',
          deploy: 'cdk deploy',
        },
        dependencies: {
          'aws-cdk-lib': '^2.150.0',
          constructs: '^10.3.0',
        },
        devDependencies: {
          'aws-cdk': '^2.150.0',
          typescript: '^5.5.0',
          'ts-node': '^10.9.2',
        },
      },
      null,
      2,
    ),
    'cdk.json': JSON.stringify({ app: 'npx ts-node --prefer-ts-exts bin/app.ts' }, null, 2),
    'bin/app.ts': `#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();
new InfrastructureStack(app, 'InfrastructureStack');
`,
    'lib/infrastructure-stack.ts': stack,
    'README.md': `# InfraCanvas Generated CDK Project

This scaffold was generated from an InfraCanvas graph.

## Workflow Notes

- Browser uploads should use presigned S3 PUT URLs.
- DynamoDB-triggered VM work should flow through DynamoDB Streams -> Lambda -> EC2 RunInstances.
- Review IAM policies and replace wildcard RunInstances/PassRole resources before production.
- Dynamic EC2 jobs still need user data or launch-template code that downloads the script from S3, runs it, uploads output, updates DynamoDB, and terminates the instance.

## Commands

\`\`\`bash
npm install
npm run build
npm run synth
\`\`\`
`,
  };
}
