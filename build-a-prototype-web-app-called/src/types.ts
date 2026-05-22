import type { Edge, Node, XYPosition } from '@xyflow/react';

export type AwsResourceType =
  | 'webClient'
  | 'lambda'
  | 's3'
  | 'dynamodb'
  | 'apiGateway'
  | 'sqs'
  | 'ec2'
  | 'eventBridge'
  | 'iamRole'
  | 'scriptAsset'
  | 'textBoard';

export type Severity = 'error' | 'warning' | 'info';

export type ResourceConfig = Record<string, string | boolean | number>;

export type InfraNodeData = {
  resourceType: AwsResourceType;
  label: string;
  icon: string;
  config: ResourceConfig;
};

export type InfraNode = Node<InfraNodeData, 'infraNode'>;

export type InfraEdgeData = {
  connectionType: string;
  cdkAction?: string;
  validation?: ValidationIssue;
};

export type InfraEdge = Edge<InfraEdgeData> & {
  pathOptions?: {
    borderRadius?: number;
    centerY?: number;
    offset?: number;
  };
};

export type GraphModel = {
  nodes: Array<{
    id: string;
    type: AwsResourceType;
    name: string;
    position: XYPosition;
    config: ResourceConfig;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    connectionType: string;
    cdkAction?: string;
  }>;
};

export type AwsRule = {
  sourceType: AwsResourceType;
  targetType: AwsResourceType;
  valid: boolean;
  severity: Severity;
  message: string;
  cdkHint: string;
  requiredPermission?: string;
};

export type ValidationIssue = {
  id: string;
  edgeId?: string;
  sourceId?: string;
  targetId?: string;
  severity: Severity;
  valid: boolean;
  message: string;
  cdkHint?: string;
  requiredPermission?: string;
};

export type SavedProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
};
