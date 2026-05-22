import { Info, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { resourceByType } from '../data/awsResources';
import { getCdkActionOption, getCdkActionOptions } from '../rules/cdkActions';
import type { AwsResourceType, InfraEdge, InfraNode } from '../types';

type InspectorProps = {
  node?: InfraNode;
  edge?: InfraEdge;
  nodes: InfraNode[];
  onUpdateNode: (nodeId: string, patch: { label?: string; config?: Record<string, string | number | boolean> }) => void;
  onUpdateEdge: (edgeId: string, patch: { connectionType?: string; cdkAction?: string }) => void;
};

type DetailTopic = {
  title: string;
  body: string;
  items?: Array<{ label: string; description: string }>;
};

const connectionTypeDetails: DetailTopic = {
  title: 'Connection type',
  body: 'Connection type is the kind of AWS relationship this edge represents. It controls which CDK actions make sense for the selected source and target.',
  items: [
    { label: 'Integration', description: 'A request-time wiring. Example: API Gateway forwards POST /submit-to-dynamo to a Lambda function.' },
    { label: 'Permission', description: 'An IAM grant. Example: a Lambda role can put objects in an S3 bucket or write items to DynamoDB.' },
    { label: 'Trigger', description: 'An event source. Example: DynamoDB Streams, SQS, or S3 events invoke a Lambda function.' },
    { label: 'Network access', description: 'A reachability relationship, such as private connectivity or security-group style access. This prototype mostly treats it as a design note.' },
  ],
};

const cdkActionDetails: DetailTopic = {
  title: 'CDK action',
  body: 'CDK action is the exact CDK method or pattern InfraCanvas should generate for this edge. The options change based on the connection type and the two resources you connected.',
  items: [
    { label: 'Permission actions', description: 'These are usually grant methods or IAM policy statements, such as bucket.grantPut(lambdaFn).' },
    { label: 'Integration actions', description: 'These wire services together, such as API Gateway LambdaIntegration for an API route.' },
    { label: 'Trigger actions', description: 'These attach event sources, such as DynamoEventSource or SqsEventSource for Lambda.' },
  ],
};

const fieldDetails: Partial<Record<`${AwsResourceType}.${string}`, DetailTopic>> = {
  'webClient.origin': {
    title: 'Allowed origin',
    body: 'The browser origin that is allowed to call your API or upload directly to S3. For local Vite development this is usually http://localhost:5173.',
  },
  'webClient.uploadMode': {
    title: 'Upload mode',
    body: 'How the browser sends files. presigned-s3-put means the browser asks the API for a temporary S3 PUT URL, then uploads the file directly to S3 instead of sending file bytes through Lambda.',
  },
  'lambda.purpose': {
    title: 'Purpose',
    body: 'The job this Lambda performs in the architecture. For example, presigned-url creates upload URLs, dynamodb-writer saves submitted metadata, and ec2-launcher starts a worker VM.',
  },
  'lambda.runtime': {
    title: 'Runtime',
    body: 'The language runtime AWS Lambda uses to execute the function code, such as Node.js 20.x or Python 3.12.',
  },
  'lambda.handler': {
    title: 'Handler',
    body: 'The exported function Lambda invokes when it runs your code. For a NodejsFunction entry file, handler usually means the file exports a function named handler.',
    items: [{ label: 'Example', description: 'If index.ts contains export async function handler(event) { ... }, the handler value is handler.' }],
  },
  'lambda.entry': {
    title: 'Nodejs entry',
    body: 'The local TypeScript or JavaScript file used as the Lambda entry point. CDK bundles this file and its imports into the deployed function code.',
  },
  'lambda.apiPath': {
    title: 'API route path',
    body: 'The API Gateway path that should route to this Lambda when the Lambda is connected to an API Gateway node.',
    items: [{ label: 'Example', description: '/submit-to-dynamo becomes an API route for submitting text and the S3 input file path.' }],
  },
  'lambda.apiMethod': {
    title: 'API method',
    body: 'The HTTP method API Gateway accepts for this Lambda route, such as GET for health checks or POST for form submissions.',
  },
  'lambda.memorySize': {
    title: 'Memory MB',
    body: 'The amount of memory allocated to the Lambda function. More memory can also provide more CPU and network throughput, but costs more per millisecond.',
  },
  's3.versioned': {
    title: 'Versioned',
    body: 'Whether S3 keeps previous versions of objects. Useful for recovery and audit trails, but it can increase storage cost.',
  },
  's3.removalPolicy': {
    title: 'Removal policy',
    body: 'What happens to the bucket when the CDK stack is destroyed. DESTROY is convenient for prototypes; RETAIN is safer for important data.',
  },
  's3.corsOrigins': {
    title: 'CORS origins',
    body: 'The browser origins allowed to upload to or read from this bucket directly. This must include your frontend origin for presigned browser uploads to work.',
  },
  'dynamodb.partitionKey': {
    title: 'Partition key',
    body: 'The primary key attribute DynamoDB uses to locate items. In your workflow, id identifies the submitted job record.',
  },
  'dynamodb.billingMode': {
    title: 'Billing mode',
    body: 'How DynamoDB capacity is billed. PAY_PER_REQUEST is simple for prototypes and variable traffic; PROVISIONED is for planned throughput.',
  },
  'dynamodb.stream': {
    title: 'Stream',
    body: 'Whether DynamoDB publishes item changes to DynamoDB Streams. A stream is required if a table update should trigger a Lambda.',
  },
  'apiGateway.apiType': {
    title: 'API type',
    body: 'REST API is the classic API Gateway construct with broad CDK support. HTTP API is lighter and often cheaper, but has a different CDK module and feature set.',
  },
  'apiGateway.stageName': {
    title: 'Stage name',
    body: 'The deployed API stage name, such as prod or dev. It appears in the invoke URL for REST APIs.',
  },
  'apiGateway.corsOrigins': {
    title: 'CORS origins',
    body: 'The frontend origins allowed to call this API from a browser. Without matching CORS settings, browser requests can fail before they reach Lambda.',
  },
  'sqs.visibilityTimeout': {
    title: 'Visibility timeout',
    body: 'How long a message stays hidden after a consumer receives it. It should be longer than the Lambda or worker processing time.',
  },
  'sqs.retentionDays': {
    title: 'Retention days',
    body: 'How long SQS keeps messages that have not been deleted. Longer retention gives more time to recover from processing failures.',
  },
  'ec2.instanceType': {
    title: 'Instance type',
    body: 'The EC2 hardware size used for the worker VM, such as t3.micro. It determines CPU, memory, networking, and cost.',
  },
  'ec2.machineImage': {
    title: 'Machine image',
    body: 'The operating system image used to boot the VM. Your CDK stack uses the latest Amazon Linux 2023 AMI through SSM lookup.',
  },
  'ec2.launchMode': {
    title: 'Launch mode',
    body: 'dynamic means a Lambda creates the VM when a job arrives. static means the VM exists as a normal CDK ec2.Instance construct.',
  },
  'ec2.autoTerminate': {
    title: 'Auto terminate',
    body: 'Whether the worker VM should shut itself down after the script finishes. This keeps one-off job infrastructure from continuing to bill.',
  },
  'eventBridge.schedule': {
    title: 'Schedule',
    body: 'A rate or cron expression that controls when EventBridge fires the rule, such as rate(5 minutes).',
  },
  'eventBridge.eventPattern': {
    title: 'Event pattern',
    body: 'A JSON-like pattern that filters which events should match this EventBridge rule.',
  },
  'iamRole.assumedBy': {
    title: 'Assumed by',
    body: 'The AWS service allowed to use this role. For an EC2 instance profile, this is ec2.amazonaws.com.',
  },
  'iamRole.includeInstanceProfile': {
    title: 'Instance profile',
    body: 'Whether to create an EC2 instance profile for this role. EC2 needs an instance profile to receive IAM permissions.',
  },
  'scriptAsset.localPath': {
    title: 'Local path',
    body: 'The path in your project where the worker script lives before deployment.',
  },
  'scriptAsset.s3Key': {
    title: 'S3 key',
    body: 'The object key where the script should be uploaded in S3. The worker VM downloads this key before running the script.',
  },
  'textBoard.body': {
    title: 'Text',
    body: 'Freeform notes that live on the canvas. This does not generate CDK and cannot connect to infrastructure resources.',
  },
};

function resourceFieldDetail(resourceType: AwsResourceType, resourceLabel: string, fieldLabel: string, fieldKey: string): DetailTopic {
  return (
    fieldDetails[`${resourceType}.${fieldKey}`] || {
      title: fieldLabel,
      body: `${fieldLabel} controls a ${resourceLabel} setting used by the generated AWS infrastructure.`,
    }
  );
}

function DetailButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="detail-button" aria-label="Show field details" onClick={onClick}>
      <Info size={13} />
    </button>
  );
}

function DetailModal({ topic, onClose }: { topic?: DetailTopic; onClose: () => void }) {
  if (!topic) return null;

  return (
    <div className="detail-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
      <section className="detail-modal">
        <div className="detail-panel-header">
          <strong id="detail-modal-title">{topic.title}</strong>
          <button type="button" className="detail-close" aria-label="Close details" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <p>{topic.body}</p>
        {topic.items && (
          <div className="detail-list">
            {topic.items.map((item) => (
              <div key={item.label}>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function Inspector({ node, edge, nodes, onUpdateNode, onUpdateEdge }: InspectorProps) {
  const [detailTopic, setDetailTopic] = useState<DetailTopic>();
  const source = edge ? nodes.find((item) => item.id === edge.source) : undefined;
  const target = edge ? nodes.find((item) => item.id === edge.target) : undefined;
  const connectionType = edge?.data?.connectionType || 'permission';
  const cdkActions = getCdkActionOptions(source?.data.resourceType, target?.data.resourceType, connectionType);
  const selectedAction = getCdkActionOption(source?.data.resourceType, target?.data.resourceType, connectionType, edge?.data?.cdkAction);
  const cdkActionTopic = useMemo<DetailTopic>(
    () => ({
      ...cdkActionDetails,
      items: [
        ...(cdkActionDetails.items || []),
        ...(cdkActions.length
          ? cdkActions.map((action) => ({ label: action.label, description: `${action.description} Command: ${action.command}` }))
          : [{ label: 'No modeled action', description: 'This resource pair and connection type does not have a modeled CDK action yet.' }]),
      ],
    }),
    [cdkActions],
  );

  if (node) {
    const resource = resourceByType[node.data.resourceType];
    return (
      <aside className="inspector">
        <p className="eyebrow">Inspector</p>
        <h2>{resource.label}</h2>
        <label>
          <span className="field-label">
            Resource name
            <DetailButton onClick={() => setDetailTopic({ title: 'Resource name', body: 'The friendly construct name shown on the canvas and used to derive generated CDK identifiers.' })} />
          </span>
          <input value={node.data.label} onChange={(event) => onUpdateNode(node.id, { label: event.target.value })} />
        </label>
        <div className="field-grid">
          {resource.configFields.map((field) => (
            <label key={field.key}>
              <span className="field-label">
                {field.label}
                <DetailButton onClick={() => setDetailTopic(resourceFieldDetail(resource.type, resource.label, field.label, field.key))} />
              </span>
              {field.type === 'select' ? (
                <select
                  value={String(node.data.config[field.key] ?? '')}
                  onChange={(event) => onUpdateNode(node.id, { config: { [field.key]: event.target.value } })}
                >
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={String(node.data.config[field.key] ?? '')}
                  onChange={(event) => onUpdateNode(node.id, { config: { [field.key]: event.target.value } })}
                />
              ) : (
                <input
                  type={field.type}
                  value={String(node.data.config[field.key] ?? '')}
                  onChange={(event) =>
                    onUpdateNode(node.id, {
                      config: { [field.key]: field.type === 'number' ? Number(event.target.value) : event.target.value },
                    })
                  }
                />
              )}
            </label>
          ))}
        </div>
        <DetailModal topic={detailTopic} onClose={() => setDetailTopic(undefined)} />
      </aside>
    );
  }

  if (edge) {
    return (
      <aside className="inspector">
        <p className="eyebrow">Inspector</p>
        <h2>Connection</h2>
        <div className="connection-summary">
          <span>{source?.data.label || edge.source}</span>
          <strong>to</strong>
          <span>{target?.data.label || edge.target}</span>
        </div>
        <label>
          <span className="field-label">
            Connection type
            <DetailButton onClick={() => setDetailTopic(connectionTypeDetails)} />
          </span>
          <select value={connectionType} onChange={(event) => onUpdateEdge(edge.id, { connectionType: event.target.value })}>
            <option value="permission">Permission</option>
            <option value="trigger">Trigger</option>
            <option value="integration">Integration</option>
            <option value="network">Network access</option>
          </select>
        </label>
        <label>
          <span className="field-label">
            CDK action
            <DetailButton onClick={() => setDetailTopic(cdkActionTopic)} />
          </span>
          <select
            value={selectedAction?.value || 'custom'}
            onChange={(event) => onUpdateEdge(edge.id, { cdkAction: event.target.value })}
            disabled={cdkActions.length === 0}
          >
            {cdkActions.length ? (
              cdkActions.map((action) => (
                <option key={action.value} value={action.value}>
                  {action.label}
                </option>
              ))
            ) : (
              <option value="custom">No action modeled</option>
            )}
          </select>
        </label>
        <div className={`rule-card ${edge.data?.validation?.severity || 'info'}`}>
          <strong>{edge.data?.validation?.valid ? 'Supported CDK mapping' : 'Needs review'}</strong>
          <p>{edge.data?.validation?.message || 'Run validation to inspect this connection.'}</p>
          {selectedAction ? (
            <>
              <p>{selectedAction.description}</p>
              <code>{selectedAction.command}</code>
            </>
          ) : (
            edge.data?.validation?.cdkHint && <code>{edge.data.validation.cdkHint}</code>
          )}
        </div>
        <DetailModal topic={detailTopic} onClose={() => setDetailTopic(undefined)} />
      </aside>
    );
  }

  return (
    <aside className="inspector empty">
      <p className="eyebrow">Inspector</p>
      <h2>Select a resource or connection</h2>
      <p>Configure resources, review connection rules, and see generated CDK actions here.</p>
    </aside>
  );
}
