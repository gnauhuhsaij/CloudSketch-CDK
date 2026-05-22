import { getDefaultCdkAction } from '../rules/cdkActions';
import type { AwsResourceType, InfraEdge, InfraNode } from '../types';
import { resourceByType } from '../data/awsResources';

type ParsedResource = {
  variable: string;
  id: string;
  type: AwsResourceType;
  name: string;
  config?: Record<string, string | number | boolean>;
};

function titleFromIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueEdge(
  edges: InfraEdge[],
  nodesById: Map<string, InfraNode>,
  id: string,
  source: string,
  target: string,
  connectionType: string,
): InfraEdge[] {
  if (source === target || edges.some((edge) => edge.source === source && edge.target === target && edge.data?.connectionType === connectionType)) {
    return edges;
  }

  const sourceType = nodesById.get(source)?.data.resourceType;
  const targetType = nodesById.get(target)?.data.resourceType;

  return [
    ...edges,
    {
      id,
      source,
      target,
      type: 'smoothstep',
      data: {
        connectionType,
        cdkAction: getDefaultCdkAction(sourceType, targetType, connectionType),
      },
      pathOptions: { borderRadius: 14, offset: 24 },
    },
  ];
}

function makeParsedNode(resource: ParsedResource, index: number): InfraNode {
  const definition = resourceByType[resource.type];
  const columns: Record<AwsResourceType, number> = {
    webClient: 0,
    apiGateway: 1,
    lambda: 2,
    s3: 3,
    dynamodb: 3,
    iamRole: 4,
    scriptAsset: 4,
    ec2: 5,
    sqs: 3,
    eventBridge: 1,
  };
  const sameColumnOffset = index % 4;

  return {
    id: resource.variable,
    type: 'infraNode',
    position: {
      x: -540 + columns[resource.type] * 280,
      y: -180 + sameColumnOffset * 130,
    },
    data: {
      resourceType: resource.type,
      label: resource.name || definition.label,
      icon: definition.shortLabel,
      config: { ...definition.defaultConfig, ...resource.config },
    },
  };
}

function findResourceType(expression: string): AwsResourceType | undefined {
  if (/\bnew\s+s3\.Bucket\b/.test(expression)) return 's3';
  if (/\bnew\s+(?:lambdaNodejs\.)?NodejsFunction\b/.test(expression) || /\bnew\s+lambda\.Function\b/.test(expression)) return 'lambda';
  if (/\bnew\s+apigw\.LambdaRestApi\b/.test(expression) || /\bnew\s+apigw\.RestApi\b/.test(expression) || /\bnew\s+apigateway\.RestApi\b/.test(expression)) return 'apiGateway';
  if (/\bnew\s+dynamodb\.Table(?:V2)?\b/.test(expression)) return 'dynamodb';
  if (/\bnew\s+iam\.Role\b/.test(expression)) return 'iamRole';
  if (/\bnew\s+ec2\.Instance\b/.test(expression)) return 'ec2';
  if (/\bnew\s+sqs\.Queue\b/.test(expression)) return 'sqs';
  if (/\bnew\s+events\.Rule\b/.test(expression)) return 'eventBridge';
  if (/\bnew\s+s3deploy\.BucketDeployment\b/.test(expression)) return 'scriptAsset';
  return undefined;
}

function resourceConfig(type: AwsResourceType, body: string) {
  const config: Record<string, string | number | boolean> = {};
  const entry = body.match(/entry:\s*path\.join\([^,]+,\s*['"`]\.\.\/([^'"`]+)['"`]\)/);
  const handler = body.match(/handler:\s*['"`]([^'"`]+)['"`]/);
  const runtime = body.match(/runtime:\s*lambda\.Runtime\.([A-Z0-9_]+)/);
  const tableName = body.match(/TABLE_NAME:\s*([A-Za-z0-9_.]+)/);
  const bucketName = body.match(/BUCKET_NAME:\s*([A-Za-z0-9_.]+)/);

  if (type === 'lambda') {
    if (entry) config.entry = entry[1];
    if (handler) config.handler = handler[1];
    if (runtime) config.runtime = runtime[1].toLowerCase().replace('nodejs_', 'nodejs').replace('_x', '.x');
    if (/RunInstances|launchInstance|profileName|ImageID/.test(body)) config.purpose = 'ec2-launcher';
    if (/getPresigned|BUCKET_NAME/.test(body) && !/RunInstances/.test(body)) config.purpose = 'presigned-url';
    if (/TABLE_NAME/.test(body) && !/DynamoEventSource/.test(body)) config.purpose = 'dynamodb-writer';
  }

  if (type === 's3') {
    const corsOrigins = [...body.matchAll(/allowedOrigins:\s*\[([^\]]+)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((origin) => origin[1]))
      .join(', ');
    if (corsOrigins) config.corsOrigins = corsOrigins;
    if (/versioned:\s*true/.test(body)) config.versioned = 'true';
  }

  if (type === 'dynamodb' && /dynamoStream|stream:\s*dynamodb\.StreamViewType\.NEW_IMAGE/.test(body)) {
    config.stream = 'NEW_IMAGE';
  }

  if (type === 'iamRole') {
    const assumedBy = body.match(/new\s+iam\.ServicePrincipal\(['"`]([^'"`]+)['"`]\)/);
    if (assumedBy) config.assumedBy = assumedBy[1];
  }

  if (tableName) config.tableEnv = tableName[1];
  if (bucketName) config.bucketEnv = bucketName[1];
  return config;
}

export function parseCdkStack(source: string): { nodes: InfraNode[]; edges: InfraEdge[] } {
  const resources: ParsedResource[] = [];
  const constructPattern =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+((?:[A-Za-z_$][\w$]*\.)?[A-Za-z_$][\w$]*)\s*\(\s*this\s*,\s*['"`]([^'"`]+)['"`]([\s\S]*?)\n\s*\);/g;

  for (const match of source.matchAll(constructPattern)) {
    const [, variable, constructorName, constructId, body] = match;
    const type = findResourceType(`new ${constructorName}`);
    if (!type) continue;
    resources.push({
      variable,
      id: constructId,
      type,
      name: titleFromIdentifier(constructId || variable),
      config: resourceConfig(type, body),
    });
  }

  const hasBrowserFlow = /allowedOrigins|get-presigned-url|presigned|localhost:5173/i.test(source);
  if (hasBrowserFlow && !resources.some((resource) => resource.type === 'webClient')) {
    resources.unshift({
      variable: 'web-ui',
      id: 'ReactWebUI',
      type: 'webClient',
      name: 'React Web UI',
      config: { origin: 'http://localhost:5173' },
    });
  }

  const hasDynamicEc2 =
    /ec2:RunInstances|RunInstances|iam:PassRole|InstanceProfile|profileName|valueForStringParameter\(.*ami-amazon-linux-latest/s.test(source);
  if (hasDynamicEc2 && !resources.some((resource) => resource.type === 'ec2')) {
    resources.push({
      variable: 'ephemeral-worker-vm',
      id: 'EphemeralWorkerVM',
      type: 'ec2',
      name: 'Ephemeral Worker VM',
      config: { launchMode: 'dynamic', autoTerminate: 'true' },
    });
  }

  const nodes = resources.map(makeParsedNode);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeByVariable = new Map(nodes.map((node) => [node.id, node]));
  const variablesByType = (type: AwsResourceType) => nodes.filter((node) => node.data.resourceType === type).map((node) => node.id);
  let edges: InfraEdge[] = [];
  const edgeId = (prefix: string, sourceId: string, targetId: string) => `${prefix}-${sourceId}-${targetId}`;

  const webClient = variablesByType('webClient')[0];
  const api = variablesByType('apiGateway')[0];
  const bucket = variablesByType('s3')[0];
  if (webClient && api) edges = uniqueEdge(edges, nodesById, edgeId('web-api', webClient, api), webClient, api, 'integration');
  if (webClient && bucket) edges = uniqueEdge(edges, nodesById, edgeId('web-s3', webClient, bucket), webClient, bucket, 'permission');

  for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\.grant(ReadWrite|Read|Write|Put|Delete)\(([^)]+)\)/g)) {
    const [, resourceVariable, action, principalExpression] = match;
    const principalVariable = principalExpression.match(/[A-Za-z_$][\w$]*/)?.[0];
    const resource = nodeByVariable.get(resourceVariable);
    const principal = principalVariable ? nodeByVariable.get(principalVariable) : undefined;
    if (!resource || !principal) continue;
    edges = uniqueEdge(edges, nodesById, edgeId(`grant${action}`, principal.id, resource.id), principal.id, resource.id, 'permission');
  }

  for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\.grant(ReadWriteData|ReadData|WriteData|FullAccess)\(([^)]+)\)/g)) {
    const [, tableVariable, action, principalExpression] = match;
    const principalVariable = principalExpression.match(/[A-Za-z_$][\w$]*/)?.[0];
    const table = nodeByVariable.get(tableVariable);
    const principal = principalVariable ? nodeByVariable.get(principalVariable) : undefined;
    if (!table || !principal) continue;
    edges = uniqueEdge(edges, nodesById, edgeId(`grant${action}`, principal.id, table.id), principal.id, table.id, 'permission');
  }

  for (const match of source.matchAll(/new\s+apigw\.LambdaIntegration\(([^)]+)\)|new\s+apigateway\.LambdaIntegration\(([^)]+)\)/g)) {
    const lambdaVariable = (match[1] || match[2] || '').match(/[A-Za-z_$][\w$]*/)?.[0];
    if (api && lambdaVariable && nodeByVariable.has(lambdaVariable)) {
      edges = uniqueEdge(edges, nodesById, edgeId('api-lambda', api, lambdaVariable), api, lambdaVariable, 'integration');
    }
  }

  for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\.addEventSource\(\s*new\s+lambdaEventSources\.DynamoEventSource\(([^,)]+)/g)) {
    const [, lambdaVariable, tableVariable] = match;
    if (nodeByVariable.has(lambdaVariable) && nodeByVariable.has(tableVariable)) {
      edges = uniqueEdge(edges, nodesById, edgeId('dynamo-trigger', tableVariable, lambdaVariable), tableVariable, lambdaVariable, 'trigger');
    }
  }

  const vm = variablesByType('ec2')[0];
  const roles = variablesByType('iamRole');
  if (vm) {
    roles.forEach((role) => {
      edges = uniqueEdge(edges, nodesById, edgeId('role-vm', role, vm), role, vm, 'permission');
    });
    variablesByType('lambda').forEach((lambda) => {
      const label = nodeByVariable.get(lambda)?.data.label || '';
      if (/launch|instance|ec2/i.test(label)) {
        edges = uniqueEdge(edges, nodesById, edgeId('lambda-vm', lambda, vm), lambda, vm, 'permission');
      }
    });
  }

  return { nodes, edges };
}
