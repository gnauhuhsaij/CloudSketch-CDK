import {
  Box,
  Braces,
  CloudLightning,
  Database,
  HardDrive,
  KeyRound,
  Monitor,
  Network,
  NotebookText,
  ScrollText,
  RadioTower,
} from 'lucide-react';
import type { AwsResourceType, ResourceConfig } from '../types';

export type ResourceDefinition = {
  type: AwsResourceType;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  Icon: typeof CloudLightning;
  defaultConfig: ResourceConfig;
  configFields: Array<{
    key: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'textarea';
    options?: string[];
  }>;
};

export const awsResources: ResourceDefinition[] = [
  {
    type: 'textBoard',
    label: 'Text board',
    shortLabel: 'TXT',
    description: 'Project notes and comments',
    color: '#a3a3a3',
    Icon: NotebookText,
    defaultConfig: {
      body: 'Describe this workflow, assumptions, open questions, or deployment notes.',
      width: 260,
      height: 150,
    },
    configFields: [{ key: 'body', label: 'Text', type: 'textarea' }],
  },
  {
    type: 'webClient',
    label: 'Web UI',
    shortLabel: 'UI',
    description: 'React browser client',
    color: '#0f766e',
    Icon: Monitor,
    defaultConfig: { origin: 'http://localhost:5173', uploadMode: 'presigned-s3-put' },
    configFields: [
      { key: 'origin', label: 'Allowed origin', type: 'text' },
      { key: 'uploadMode', label: 'Upload mode', type: 'select', options: ['presigned-s3-put', 'api-submit-only'] },
    ],
  },
  {
    type: 'lambda',
    label: 'Lambda',
    shortLabel: 'FN',
    description: 'Serverless compute function',
    color: '#da6f13',
    Icon: CloudLightning,
    defaultConfig: {
      runtime: 'nodejs20.x',
      handler: 'handler',
      memorySize: 128,
      purpose: 'generic',
      entry: 'lambdas/handler/index.ts',
      apiPath: '/',
      apiMethod: 'POST',
    },
    configFields: [
      {
        key: 'purpose',
        label: 'Purpose',
        type: 'select',
        options: ['generic', 'healthcheck', 'presigned-url', 'dynamodb-writer', 'ec2-launcher'],
      },
      { key: 'runtime', label: 'Runtime', type: 'select', options: ['nodejs20.x', 'python3.12', 'java21'] },
      { key: 'handler', label: 'Handler', type: 'text' },
      { key: 'entry', label: 'Nodejs entry', type: 'text' },
      { key: 'apiPath', label: 'API route path', type: 'text' },
      { key: 'apiMethod', label: 'API method', type: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'ANY'] },
      { key: 'memorySize', label: 'Memory MB', type: 'number' },
    ],
  },
  {
    type: 's3',
    label: 'S3 Bucket',
    shortLabel: 'S3',
    description: 'Object storage bucket',
    color: '#2f855a',
    Icon: HardDrive,
    defaultConfig: { versioned: 'true', removalPolicy: 'DESTROY', corsOrigins: 'http://localhost:5173' },
    configFields: [
      { key: 'versioned', label: 'Versioned', type: 'select', options: ['true', 'false'] },
      { key: 'removalPolicy', label: 'Removal policy', type: 'select', options: ['DESTROY', 'RETAIN'] },
      { key: 'corsOrigins', label: 'CORS origins', type: 'text' },
    ],
  },
  {
    type: 'dynamodb',
    label: 'DynamoDB Table',
    shortLabel: 'DB',
    description: 'NoSQL table',
    color: '#2563eb',
    Icon: Database,
    defaultConfig: { partitionKey: 'id', billingMode: 'PAY_PER_REQUEST', stream: 'NEW_IMAGE' },
    configFields: [
      { key: 'partitionKey', label: 'Partition key', type: 'text' },
      { key: 'billingMode', label: 'Billing mode', type: 'select', options: ['PAY_PER_REQUEST', 'PROVISIONED'] },
      { key: 'stream', label: 'Stream', type: 'select', options: ['NEW_IMAGE', 'NEW_AND_OLD_IMAGES', 'DISABLED'] },
    ],
  },
  {
    type: 'apiGateway',
    label: 'API Gateway',
    shortLabel: 'API',
    description: 'HTTP API endpoint',
    color: '#7c3aed',
    Icon: Network,
    defaultConfig: { apiType: 'REST', stageName: 'prod', corsOrigins: '*' },
    configFields: [
      { key: 'apiType', label: 'API type', type: 'select', options: ['REST', 'HTTP'] },
      { key: 'stageName', label: 'Stage name', type: 'text' },
      { key: 'corsOrigins', label: 'CORS origins', type: 'text' },
    ],
  },
  {
    type: 'sqs',
    label: 'SQS Queue',
    shortLabel: 'Q',
    description: 'Message queue',
    color: '#b7791f',
    Icon: Box,
    defaultConfig: { visibilityTimeout: 30, retentionDays: 4 },
    configFields: [
      { key: 'visibilityTimeout', label: 'Visibility timeout', type: 'number' },
      { key: 'retentionDays', label: 'Retention days', type: 'number' },
    ],
  },
  {
    type: 'ec2',
    label: 'EC2 Instance',
    shortLabel: 'EC2',
    description: 'Virtual machine',
    color: '#c2410c',
    Icon: Braces,
    defaultConfig: { instanceType: 't3.micro', machineImage: 'amazon-linux-2023', launchMode: 'dynamic', autoTerminate: 'true' },
    configFields: [
      { key: 'instanceType', label: 'Instance type', type: 'text' },
      { key: 'machineImage', label: 'Machine image', type: 'text' },
      { key: 'launchMode', label: 'Launch mode', type: 'select', options: ['dynamic', 'static'] },
      { key: 'autoTerminate', label: 'Auto terminate', type: 'select', options: ['true', 'false'] },
    ],
  },
  {
    type: 'eventBridge',
    label: 'EventBridge Rule',
    shortLabel: 'EV',
    description: 'Scheduled or event rule',
    color: '#0891b2',
    Icon: RadioTower,
    defaultConfig: { schedule: 'rate(5 minutes)', eventPattern: '' },
    configFields: [
      { key: 'schedule', label: 'Schedule', type: 'text' },
      { key: 'eventPattern', label: 'Event pattern', type: 'text' },
    ],
  },
  {
    type: 'iamRole',
    label: 'IAM Role/Profile',
    shortLabel: 'IAM',
    description: 'Execution role or instance profile',
    color: '#4b5563',
    Icon: KeyRound,
    defaultConfig: { assumedBy: 'ec2.amazonaws.com', includeInstanceProfile: 'true' },
    configFields: [
      { key: 'assumedBy', label: 'Assumed by', type: 'select', options: ['ec2.amazonaws.com', 'lambda.amazonaws.com'] },
      { key: 'includeInstanceProfile', label: 'Instance profile', type: 'select', options: ['true', 'false'] },
    ],
  },
  {
    type: 'scriptAsset',
    label: 'Script Asset',
    shortLabel: 'SH',
    description: 'Script uploaded for VM runtime',
    color: '#be123c',
    Icon: ScrollText,
    defaultConfig: { localPath: 'scripts/process-input.sh', s3Key: 'scripts/process-input.sh' },
    configFields: [
      { key: 'localPath', label: 'Local path', type: 'text' },
      { key: 's3Key', label: 'S3 key', type: 'text' },
    ],
  },
];

export const resourceByType = Object.fromEntries(awsResources.map((resource) => [resource.type, resource])) as Record<
  AwsResourceType,
  ResourceDefinition
>;
