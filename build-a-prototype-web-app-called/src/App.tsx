import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { Canvas } from './components/Canvas';
import { CodeModal } from './components/CodeModal';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ValidationPanel } from './components/ValidationPanel';
import { resourceByType } from './data/awsResources';
import { generateCdkProject } from './generator/generateCdkProject';
import { parseCdkStack } from './parser/parseCdkStack';
import { getDefaultCdkAction } from './rules/cdkActions';
import { validateGraph } from './rules/validateGraph';
import type { AwsResourceType, GraphModel, InfraEdge, InfraNode, ValidationIssue } from './types';

const BOARD_STORAGE_KEY = 'infracanvas.board.v1';
const HISTORY_LIMIT = 80;

function nodeName(type: AwsResourceType, count: number) {
  return `${resourceByType[type].label} ${count}`;
}

function toGraph(nodes: InfraNode[], edges: InfraEdge[]): GraphModel {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.resourceType,
      name: node.data.label,
      position: node.position,
      config: node.data.config,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      connectionType: edge.data?.connectionType || 'permission',
      cdkAction: edge.data?.cdkAction,
    })),
  };
}

function decorateEdges(edges: InfraEdge[], issues: ValidationIssue[], graphNodes: InfraNode[] = []) {
  const routedEdges = routeEdges(edges, graphNodes);

  return routedEdges.map((edge) => {
    const validation = issues.find((issue) => issue.edgeId === edge.id);
    const color = validation?.severity === 'error' ? '#f87171' : validation?.severity === 'warning' ? '#fbbf24' : '#f5f5f5';
    return {
      ...edge,
      data: { connectionType: edge.data?.connectionType || 'permission', cdkAction: edge.data?.cdkAction, validation },
      animated: validation?.valid === true,
      style: { stroke: color, strokeWidth: validation?.severity === 'error' ? 4 : 3 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
}

function routeEdges(edges: InfraEdge[], graphNodes: InfraNode[] = []): InfraEdge[] {
  const sourceCounts = new Map<string, InfraEdge[]>();
  const targetCounts = new Map<string, InfraEdge[]>();
  const nodeCenters = new Map(graphNodes.map((node) => [node.id, { x: node.position.x + 99, y: node.position.y + 32 }]));
  const edgeGeometry = new Map<
    string,
    {
      orientation: 'horizontal' | 'vertical';
      band: number;
      min: number;
      max: number;
      mid: number;
      length: number;
    }
  >();

  edges.forEach((edge) => {
    sourceCounts.set(edge.source, [...(sourceCounts.get(edge.source) || []), edge]);
    targetCounts.set(edge.target, [...(targetCounts.get(edge.target) || []), edge]);

    const source = nodeCenters.get(edge.source);
    const target = nodeCenters.get(edge.target);
    if (source && target) {
      const isMostlyHorizontal = Math.abs(target.x - source.x) >= Math.abs(target.y - source.y);
      const orientation = isMostlyHorizontal ? 'horizontal' : 'vertical';
      edgeGeometry.set(edge.id, {
        orientation,
        band: isMostlyHorizontal ? (source.y + target.y) / 2 : (source.x + target.x) / 2,
        min: isMostlyHorizontal ? Math.min(source.x, target.x) : Math.min(source.y, target.y),
        max: isMostlyHorizontal ? Math.max(source.x, target.x) : Math.max(source.y, target.y),
        mid: isMostlyHorizontal ? (source.y + target.y) / 2 : (source.x + target.x) / 2,
        length: isMostlyHorizontal ? Math.abs(target.x - source.x) : Math.abs(target.y - source.y),
      });
    }
  });

  return edges.map((edge) => {
    const outgoing = sourceCounts.get(edge.source) || [];
    const incoming = targetCounts.get(edge.target) || [];
    const sourceLane = outgoing.length > 1 ? outgoing.findIndex((item) => item.id === edge.id) : 0;
    const targetLane = incoming.length > 1 ? incoming.findIndex((item) => item.id === edge.id) : 0;
    const lane = Math.max(sourceLane, targetLane);
    const hasSharedEndpoint = outgoing.length > 1 || incoming.length > 1;
    const source = nodeCenters.get(edge.source);
    const target = nodeCenters.get(edge.target);
    const geometry = edgeGeometry.get(edge.id);
    const trackEdges =
      geometry && !hasSharedEndpoint
        ? edges.filter((candidate) => {
            if (candidate.id === edge.id) return true;
            const candidateGeometry = edgeGeometry.get(candidate.id);
            if (!candidateGeometry || candidateGeometry.orientation !== geometry.orientation) return false;
            const bandDistance = Math.abs(candidateGeometry.band - geometry.band);
            const projectedOverlap = Math.min(geometry.max, candidateGeometry.max) - Math.max(geometry.min, candidateGeometry.min);
            const meaningfulOverlap = projectedOverlap > Math.min(geometry.length, candidateGeometry.length) * 0.18 && projectedOverlap > 72;
            return bandDistance < 34 && meaningfulOverlap;
          })
        : [];
    const trackLane = trackEdges.length > 1 ? trackEdges.findIndex((item) => item.id === edge.id) : 0;
    const effectiveLane = Math.max(lane, trackLane);
    const hasSharedTrack = hasSharedEndpoint || trackEdges.length > 1;
    const offset = hasSharedTrack ? 22 + effectiveLane * 18 : 18;
    const centerShift = hasSharedTrack && geometry ? (effectiveLane - ((trackEdges.length || 1) - 1) / 2) * 30 : 0;
    const isMostlyHorizontal = geometry?.orientation !== 'vertical';

    return {
      ...edge,
      type: edge.type || 'smoothstep',
      pathOptions: {
        borderRadius: 14,
        ...(source && target && isMostlyHorizontal && hasSharedTrack ? { centerY: geometry!.mid + centerShift } : {}),
        offset,
      },
    };
  });
}

function applyGraphFocus(nodes: InfraNode[], edges: InfraEdge[], selectedNodeId?: string, selectedEdgeId?: string) {
  if (!selectedNodeId && !selectedEdgeId) return { focusedNodes: nodes, focusedEdges: edges };

  const visibleNodeIds = new Set<string>();
  const visibleEdgeIds = new Set<string>();

  if (selectedNodeId) {
    visibleNodeIds.add(selectedNodeId);
    edges.forEach((edge) => {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        visibleEdgeIds.add(edge.id);
        visibleNodeIds.add(edge.source);
        visibleNodeIds.add(edge.target);
      }
    });
  }

  if (selectedEdgeId) {
    const edge = edges.find((item) => item.id === selectedEdgeId);
    if (edge) {
      visibleEdgeIds.add(edge.id);
      visibleNodeIds.add(edge.source);
      visibleNodeIds.add(edge.target);
    }
  }

  return {
    focusedNodes: nodes.map((node) => ({
      ...node,
      className: visibleNodeIds.has(node.id) ? 'graph-focus' : 'graph-muted',
    })),
    focusedEdges: edges.map((edge) => ({
      ...edge,
      className: visibleEdgeIds.has(edge.id) ? 'graph-focus' : 'graph-muted',
    })),
  };
}

function makeNode(id: string, type: AwsResourceType, label: string, position: { x: number; y: number }, config = {}): InfraNode {
  const resource = resourceByType[type];
  return {
    id,
    type: 'infraNode',
    position,
    data: {
      resourceType: type,
      label,
      icon: resource.shortLabel,
      config: { ...resource.defaultConfig, ...config },
    },
  };
}

function makeEdge(id: string, source: string, target: string, connectionType = 'permission'): InfraEdge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    data: { connectionType },
    pathOptions: { borderRadius: 14, offset: 24 },
  };
}

function fromGraph(graph: GraphModel) {
  const nodes = graph.nodes.map((node) => makeNode(node.id, node.type, node.name, node.position, node.config));
  const edges = graph.edges.map((edge) => ({
    ...makeEdge(edge.id, edge.source, edge.target, edge.connectionType),
    data: { connectionType: edge.connectionType, cdkAction: edge.cdkAction },
  }));

  return { nodes, edges };
}

function loadSavedBoard() {
  if (typeof window === 'undefined') return { nodes: [] as InfraNode[], edges: [] as InfraEdge[] };

  try {
    const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
    if (!raw) return { nodes: [] as InfraNode[], edges: [] as InfraEdge[] };
    const graph = JSON.parse(raw) as GraphModel;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { nodes: [], edges: [] };
    const board = fromGraph(graph);
    const issues = validateGraph(graph);
    return { nodes: board.nodes, edges: decorateEdges(board.edges, issues, board.nodes) };
  } catch {
    return { nodes: [] as InfraNode[], edges: [] as InfraEdge[] };
  }
}

function InfraCanvasApp() {
  const initialBoardRef = useRef(loadSavedBoard());
  const [nodes, setNodes] = useState<InfraNode[]>(() => initialBoardRef.current.nodes);
  const [edges, setEdges] = useState<InfraEdge[]>(() => initialBoardRef.current.edges);
  const [issues, setIssues] = useState<ValidationIssue[]>(() => validateGraph(toGraph(initialBoardRef.current.nodes, initialBoardRef.current.edges)));
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [generatedFiles, setGeneratedFiles] = useState<Record<string, string>>();
  const undoStackRef = useRef<GraphModel[]>([]);
  const redoStackRef = useRef<GraphModel[]>([]);
  const { screenToFlowPosition } = useReactFlow();

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId), [edges, selectedEdgeId]);
  const { focusedNodes, focusedEdges } = useMemo(
    () => applyGraphFocus(nodes, edges, selectedNodeId, selectedEdgeId),
    [nodes, edges, selectedNodeId, selectedEdgeId],
  );

  const runValidation = useCallback(
    (nextNodes = nodes, nextEdges = edges) => {
      const nextIssues = validateGraph(toGraph(nextNodes, nextEdges));
      setIssues(nextIssues);
      setEdges((current) => decorateEdges(current, nextIssues, nextNodes));
      return nextIssues;
    },
    [nodes, edges],
  );

  useEffect(() => {
    window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(toGraph(nodes, edges)));
  }, [nodes, edges]);

  const pushHistory = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-HISTORY_LIMIT + 1), toGraph(nodes, edges)];
    redoStackRef.current = [];
  }, [nodes, edges]);

  const applyBoard = useCallback((nextNodes: InfraNode[], nextEdges: InfraEdge[], options: { record?: boolean } = {}) => {
    if (options.record) pushHistory();
    const nextIssues = validateGraph(toGraph(nextNodes, nextEdges));
    setNodes(nextNodes);
    setEdges(decorateEdges(nextEdges, nextIssues, nextNodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }, [pushHistory]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current = [...redoStackRef.current.slice(-HISTORY_LIMIT + 1), toGraph(nodes, edges)];
    const board = fromGraph(previous);
    const nextIssues = validateGraph(previous);
    setNodes(board.nodes);
    setEdges(decorateEdges(board.edges, nextIssues, board.nodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }, [nodes, edges]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current = [...undoStackRef.current.slice(-HISTORY_LIMIT + 1), toGraph(nodes, edges)];
    const board = fromGraph(next);
    const nextIssues = validateGraph(next);
    setNodes(board.nodes);
    setEdges(decorateEdges(board.edges, nextIssues, board.nodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  }, [nodes, edges]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (isEditing || !event.metaKey || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const onNodesChange = useCallback((changes: NodeChange<InfraNode>[]) => {
    if (changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'position' || change.type === 'dimensions')) {
      pushHistory();
    }
    setNodes((current) => applyNodeChanges(changes, current));
  }, [pushHistory]);

  const onEdgesChange = useCallback((changes: EdgeChange<InfraEdge>[]) => {
    if (changes.some((change) => change.type === 'add' || change.type === 'remove')) {
      pushHistory();
    }
    setEdges((current) => routeEdges(applyEdgeChanges(changes, current), nodes));
  }, [nodes, pushHistory]);

  const onConnect = useCallback((connection: Connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    pushHistory();
    setEdges((current) =>
      routeEdges(
        addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
            data: { connectionType: 'permission', cdkAction: getDefaultCdkAction(source?.data.resourceType, target?.data.resourceType, 'permission') },
            type: 'smoothstep',
            pathOptions: { borderRadius: 14, offset: 24 },
            style: { stroke: '#f5f5f5', strokeWidth: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#f5f5f5' },
          },
          current,
        ),
        nodes,
      ),
    );
  }, [nodes, pushHistory]);

  const onDropResource = useCallback(
    (type: string, event: DragEvent<HTMLDivElement>) => {
      const resource = resourceByType[type as AwsResourceType];
      if (!resource) return;

      const sameTypeCount = nodes.filter((node) => node.data.resourceType === type).length + 1;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `${type}-${Date.now()}`;
      const label = nodeName(type as AwsResourceType, sameTypeCount);

      pushHistory();
      setNodes((current) => [
        ...current,
        {
          id,
          type: 'infraNode',
          position,
          data: {
            resourceType: type as AwsResourceType,
            label,
            icon: resource.shortLabel,
            config: { ...resource.defaultConfig },
          },
        },
      ]);
    },
    [nodes, pushHistory, screenToFlowPosition],
  );

  function updateNode(nodeId: string, patch: { label?: string; config?: Record<string, string | number | boolean> }) {
    pushHistory();
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                label: patch.label ?? node.data.label,
                config: { ...node.data.config, ...patch.config },
              },
            }
          : node,
      ),
    );
  }

  function updateEdge(edgeId: string, patch: { connectionType?: string; cdkAction?: string }) {
    pushHistory();
    setEdges((current) =>
      routeEdges(current.map((edge) =>
        {
          if (edge.id !== edgeId) return edge;
          const source = nodes.find((node) => node.id === edge.source);
          const target = nodes.find((node) => node.id === edge.target);
          const nextConnectionType = patch.connectionType ?? edge.data?.connectionType ?? 'permission';
          const nextAction =
            patch.cdkAction ??
            (patch.connectionType
              ? getDefaultCdkAction(source?.data.resourceType, target?.data.resourceType, nextConnectionType)
              : edge.data?.cdkAction);

          return {
            ...edge,
            data: {
              connectionType: nextConnectionType,
              cdkAction: nextAction,
              validation: edge.data?.validation,
            },
          };
        }), nodes),
    );
  }

  function clearCanvas() {
    applyBoard([], [], { record: true });
  }

  function loadWorkflowExample() {
    const exampleNodes: InfraNode[] = [
      makeNode('web-ui', 'webClient', 'React Web UI', { x: -560, y: -160 }),
      makeNode('api', 'apiGateway', 'Upload API', { x: -280, y: -30 }, { stageName: 'prod', corsOrigins: 'http://localhost:5173' }),
      makeNode('health', 'lambda', 'Healthcheck Lambda', { x: 20, y: -180 }, { purpose: 'healthcheck', apiPath: '/', apiMethod: 'GET', entry: 'lambdas/health/index.ts' }),
      makeNode('presigned', 'lambda', 'Get Presigned URL Lambda', { x: 20, y: -60 }, {
        purpose: 'presigned-url',
        apiPath: '/get-presigned-url',
        apiMethod: 'POST',
        entry: 'lambdas/getPresignedURL/index.ts',
      }),
      makeNode('submit', 'lambda', 'Submit To Dynamo Lambda', { x: 20, y: 80 }, {
        purpose: 'dynamodb-writer',
        apiPath: '/submit-to-dynamo',
        apiMethod: 'POST',
        entry: 'lambdas/submitToDynamo/index.ts',
      }),
      makeNode('bucket', 's3', 'Uploads Bucket', { x: 340, y: -130 }, { corsOrigins: 'http://localhost:5173', removalPolicy: 'DESTROY' }),
      makeNode('table', 'dynamodb', 'FileTable', { x: 340, y: 90 }, { partitionKey: 'id', stream: 'NEW_IMAGE' }),
      makeNode('launcher', 'lambda', 'Launch Instance Lambda', { x: 660, y: 90 }, {
        purpose: 'ec2-launcher',
        entry: 'lambdas/launchInstance/index.ts',
      }),
      makeNode('role', 'iamRole', 'EC2 Launch Role', { x: 660, y: 260 }),
      makeNode('script', 'scriptAsset', 'Processing Script', { x: 690, y: -190 }),
      makeNode('vm', 'ec2', 'Ephemeral Worker VM', { x: 980, y: 90 }, { launchMode: 'dynamic', autoTerminate: 'true' }),
    ];

    const exampleEdges = [
      makeEdge('web-api', 'web-ui', 'api', 'integration'),
      makeEdge('web-s3', 'web-ui', 'bucket', 'permission'),
      makeEdge('api-health', 'api', 'health', 'integration'),
      makeEdge('api-presigned', 'api', 'presigned', 'integration'),
      makeEdge('api-submit', 'api', 'submit', 'integration'),
      makeEdge('presigned-bucket', 'presigned', 'bucket', 'permission'),
      makeEdge('submit-table', 'submit', 'table', 'permission'),
      makeEdge('table-launcher', 'table', 'launcher', 'trigger'),
      makeEdge('launcher-vm', 'launcher', 'vm', 'permission'),
      makeEdge('role-vm', 'role', 'vm', 'permission'),
      makeEdge('role-bucket', 'role', 'bucket', 'permission'),
      makeEdge('role-table', 'role', 'table', 'permission'),
      makeEdge('script-bucket', 'script', 'bucket', 'integration'),
      makeEdge('vm-bucket', 'vm', 'bucket', 'permission'),
      makeEdge('vm-table', 'vm', 'table', 'permission'),
    ];

    applyBoard(exampleNodes, exampleEdges, { record: true });
  }

  async function loadStackFile(file: File) {
    const source = await file.text();
    const board = parseCdkStack(source);
    applyBoard(board.nodes, board.edges, { record: true });
  }

  function generateProject() {
    const freshIssues = validateGraph(toGraph(nodes, edges));
    setIssues(freshIssues);
    setEdges((current) => decorateEdges(current, freshIssues, nodes));
    setGeneratedFiles(generateCdkProject(toGraph(nodes, edges)));
  }

  function selectIssue(issue: ValidationIssue) {
    if (!issue.edgeId) return;
    setSelectedNodeId(undefined);
    setSelectedEdgeId(issue.edgeId);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: edge.id === issue.edgeId })));
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
  }

  return (
    <div className="app">
      <Toolbar
        onValidate={() => runValidation()}
        onGenerate={generateProject}
        onLoadExample={loadWorkflowExample}
        onLoadStackFile={loadStackFile}
        onClear={clearCanvas}
      />
      <div className="workspace">
        <Sidebar />
        <Canvas
          nodes={focusedNodes}
          edges={focusedEdges}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDropResource={onDropResource}
          onSelectionChange={({ nodes: nextNodes, edges: nextEdges }) => {
            setSelectedNodeId(nextNodes[0]?.id);
            setSelectedEdgeId(nextEdges[0]?.id);
          }}
        />
        <Inspector node={selectedNode} edge={selectedNode ? undefined : selectedEdge} nodes={nodes} onUpdateNode={updateNode} onUpdateEdge={updateEdge} />
      </div>
      <ValidationPanel issues={issues} onIssueSelect={selectIssue} />
      {generatedFiles && <CodeModal files={generatedFiles} onClose={() => setGeneratedFiles(undefined)} />}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <InfraCanvasApp />
    </ReactFlowProvider>
  );
}
