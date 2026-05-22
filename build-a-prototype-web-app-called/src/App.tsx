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
import type { AwsResourceType, GraphModel, InfraEdge, InfraNode, SavedProjectSummary, ValidationIssue } from './types';

const BOARD_STORAGE_KEY = 'infracanvas.board.v1';
const PROJECTS_STORAGE_KEY = 'infracanvas.projects.v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'infracanvas.activeProject.v1';
const DRAFT_STORAGE_KEY = 'infracanvas.draft.v1';
const HISTORY_LIMIT = 80;

type SavedProject = SavedProjectSummary & {
  graph: GraphModel;
};

type InitialBoard = {
  nodes: InfraNode[];
  edges: InfraEdge[];
  projects: SavedProject[];
  activeProjectId?: string;
  savedSnapshot: string;
};

type PendingBoardAction = {
  title: string;
  message: string;
  action: () => void;
};

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
      config: {
        ...node.data.config,
        ...(node.data.resourceType === 'textBoard'
          ? {
              width: node.width || node.measured?.width || node.data.config.width,
              height: node.height || node.measured?.height || node.data.config.height,
            }
          : {}),
      },
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
  const typedConfig = config as Record<string, string | number | boolean>;
  return {
    id,
    type: 'infraNode',
    position,
    ...(type === 'textBoard'
      ? {
          width: Number(typedConfig.width || 260),
          height: Number(typedConfig.height || 150),
        }
      : {}),
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

function emptyGraph(): GraphModel {
  return { nodes: [], edges: [] };
}

function graphSnapshot(graph: GraphModel) {
  return JSON.stringify(graph);
}

function isGraphEmpty(graph: GraphModel) {
  return graph.nodes.length === 0 && graph.edges.length === 0;
}

function readProjects() {
  if (typeof window === 'undefined') return [] as SavedProject[];

  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedProject[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((project) => project.id && project.name && project.graph);
  } catch {
    return [];
  }
}

function projectNameFromGraph(graph: GraphModel) {
  const mainNode = graph.nodes.find((node) => node.type === 'apiGateway') || graph.nodes[0];
  return mainNode ? `${mainNode.name} board` : 'Untitled board';
}

function loadGraphFromStorage(projects: SavedProject[]) {
  if (typeof window === 'undefined') return { graph: emptyGraph(), activeProjectId: undefined, savedSnapshot: graphSnapshot(emptyGraph()) };

  try {
    const draftRaw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    const activeProjectId = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || undefined;
    const activeProject = projects.find((project) => project.id === activeProjectId);
    const savedSnapshot = activeProject ? graphSnapshot(activeProject.graph) : graphSnapshot(emptyGraph());

    if (draftRaw) {
      const draft = JSON.parse(draftRaw) as GraphModel;
      if (Array.isArray(draft.nodes) && Array.isArray(draft.edges)) return { graph: draft, activeProjectId, savedSnapshot };
    }

    if (activeProject) return { graph: activeProject.graph, activeProjectId, savedSnapshot };

    const legacyRaw = window.localStorage.getItem(BOARD_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as GraphModel;
      if (Array.isArray(legacy.nodes) && Array.isArray(legacy.edges)) return { graph: legacy, activeProjectId: undefined, savedSnapshot: graphSnapshot(emptyGraph()) };
    }
  } catch {
    return { graph: emptyGraph(), activeProjectId: undefined, savedSnapshot: graphSnapshot(emptyGraph()) };
  }

  return { graph: emptyGraph(), activeProjectId: undefined, savedSnapshot: graphSnapshot(emptyGraph()) };
}

function loadSavedBoard(): InitialBoard {
  const projects = readProjects();
  const { graph, activeProjectId, savedSnapshot } = loadGraphFromStorage(projects);
  const board = fromGraph(graph);
  const issues = validateGraph(graph);
  return { nodes: board.nodes, edges: decorateEdges(board.edges, issues, board.nodes), projects, activeProjectId, savedSnapshot };
}

function InfraCanvasApp() {
  const initialBoardRef = useRef(loadSavedBoard());
  const [nodes, setNodes] = useState<InfraNode[]>(() => initialBoardRef.current.nodes);
  const [edges, setEdges] = useState<InfraEdge[]>(() => initialBoardRef.current.edges);
  const [issues, setIssues] = useState<ValidationIssue[]>(() => validateGraph(toGraph(initialBoardRef.current.nodes, initialBoardRef.current.edges)));
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [focusedNodeId, setFocusedNodeId] = useState<string>();
  const [focusedEdgeId, setFocusedEdgeId] = useState<string>();
  const [generatedFiles, setGeneratedFiles] = useState<Record<string, string>>();
  const [projects, setProjects] = useState<SavedProject[]>(() => initialBoardRef.current.projects);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(() => initialBoardRef.current.activeProjectId);
  const [savedSnapshot, setSavedSnapshot] = useState(() => initialBoardRef.current.savedSnapshot);
  const [pendingBoardAction, setPendingBoardAction] = useState<PendingBoardAction>();
  const undoStackRef = useRef<GraphModel[]>([]);
  const redoStackRef = useRef<GraphModel[]>([]);
  const { screenToFlowPosition } = useReactFlow();

  const currentGraph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const currentSnapshot = useMemo(() => graphSnapshot(currentGraph), [currentGraph]);
  const isDirty = currentSnapshot !== savedSnapshot;
  const hasBoardContent = !isGraphEmpty(currentGraph);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId), [edges, selectedEdgeId]);
  const { focusedNodes, focusedEdges } = useMemo(
    () => applyGraphFocus(nodes, edges, focusedNodeId, focusedEdgeId),
    [nodes, edges, focusedNodeId, focusedEdgeId],
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
    window.localStorage.setItem(BOARD_STORAGE_KEY, currentSnapshot);
    window.localStorage.setItem(DRAFT_STORAGE_KEY, currentSnapshot);
  }, [currentSnapshot]);

  useEffect(() => {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
    else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  }, [activeProjectId]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty || !hasBoardContent) return;
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, hasBoardContent]);

  const pushHistory = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-HISTORY_LIMIT + 1), currentGraph];
    redoStackRef.current = [];
  }, [currentGraph]);

  const applyBoard = useCallback((nextNodes: InfraNode[], nextEdges: InfraEdge[], options: { record?: boolean } = {}) => {
    if (options.record) pushHistory();
    const nextIssues = validateGraph(toGraph(nextNodes, nextEdges));
    setNodes(nextNodes);
    setEdges(decorateEdges(nextEdges, nextIssues, nextNodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setFocusedNodeId(undefined);
    setFocusedEdgeId(undefined);
  }, [pushHistory]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current = [...redoStackRef.current.slice(-HISTORY_LIMIT + 1), currentGraph];
    const board = fromGraph(previous);
    const nextIssues = validateGraph(previous);
    setNodes(board.nodes);
    setEdges(decorateEdges(board.edges, nextIssues, board.nodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setFocusedNodeId(undefined);
    setFocusedEdgeId(undefined);
  }, [currentGraph]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current = [...undoStackRef.current.slice(-HISTORY_LIMIT + 1), currentGraph];
    const board = fromGraph(next);
    const nextIssues = validateGraph(next);
    setNodes(board.nodes);
    setEdges(decorateEdges(board.edges, nextIssues, board.nodes));
    setIssues(nextIssues);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setFocusedNodeId(undefined);
    setFocusedEdgeId(undefined);
  }, [currentGraph]);

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
    if (source?.data.resourceType === 'textBoard' || target?.data.resourceType === 'textBoard') return;
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

  const addResourceAt = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const resource = resourceByType[type as AwsResourceType];
      if (!resource) return;

      const sameTypeCount = nodes.filter((node) => node.data.resourceType === type).length + 1;
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
    [nodes, pushHistory],
  );

  const onDropResource = useCallback(
    (type: string, event: DragEvent<HTMLDivElement>) => {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addResourceAt(type, position);
    },
    [addResourceAt, screenToFlowPosition],
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
    setActiveProjectId(undefined);
    setSavedSnapshot(graphSnapshot(emptyGraph()));
  }

  function saveCurrentProject() {
    const existingProject = projects.find((project) => project.id === activeProjectId);
    const fallbackName = existingProject?.name || projectNameFromGraph(currentGraph);
    const name = existingProject?.name || window.prompt('Save this board as', fallbackName)?.trim();
    if (!name) return false;

    const project: SavedProject = {
      id: existingProject?.id || globalThis.crypto?.randomUUID?.() || `project-${Date.now()}`,
      name,
      updatedAt: Date.now(),
      graph: currentGraph,
    };

    setProjects((current) => {
      const next = [project, ...current.filter((item) => item.id !== project.id)];
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    setActiveProjectId(project.id);
    setSavedSnapshot(currentSnapshot);
    return true;
  }

  function openGraph(graph: GraphModel, nextActiveProjectId?: string, nextSavedSnapshot = graphSnapshot(emptyGraph())) {
    const board = fromGraph(graph);
    applyBoard(board.nodes, board.edges, { record: true });
    setActiveProjectId(nextActiveProjectId);
    setSavedSnapshot(nextSavedSnapshot);
  }

  function requestBoardReplacement(action: () => void, title = 'Overwrite current board?') {
    if (!hasBoardContent || !isDirty) {
      action();
      return;
    }

    setPendingBoardAction({
      title,
      message: 'The current board has unsaved changes. Save it before leaving this workspace?',
      action,
    });
  }

  function startNewBoard() {
    requestBoardReplacement(() => openGraph(emptyGraph(), undefined, graphSnapshot(emptyGraph())), 'Start a new board?');
  }

  function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    requestBoardReplacement(() => openGraph(project.graph, project.id, graphSnapshot(project.graph)), `Open ${project.name}?`);
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

    requestBoardReplacement(() => {
      const graph = toGraph(exampleNodes, exampleEdges);
      openGraph(graph, undefined, graphSnapshot(emptyGraph()));
    }, 'Load the sample workflow?');
  }

  async function loadStackFile(file: File) {
    const source = await file.text();
    const board = parseCdkStack(source);
    requestBoardReplacement(() => {
      const graph = toGraph(board.nodes, board.edges);
      openGraph(graph, undefined, graphSnapshot(emptyGraph()));
    }, `Load ${file.name}?`);
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
    setFocusedNodeId(undefined);
    setFocusedEdgeId(issue.edgeId);
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
        onSaveProject={saveCurrentProject}
      />
      <div className="workspace">
        <Sidebar
          projects={projects.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))}
          activeProjectId={activeProjectId}
          isDirty={isDirty}
          onNewBoard={startNewBoard}
          onProjectSelect={selectProject}
        />
        <div className="main-region">
          <div className="board-region">
            <Canvas
              nodes={focusedNodes}
              edges={focusedEdges}
              selectedNodeId={focusedNodeId}
              selectedEdgeId={focusedEdgeId}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onAddResource={addResourceAt}
              onDropResource={onDropResource}
              onSelectionChange={({ nodes: nextNodes, edges: nextEdges }) => {
                setSelectedNodeId(nextNodes[0]?.id);
                setSelectedEdgeId(nextEdges[0]?.id);
              }}
              onFocusChange={({ nodes: nextNodes, edges: nextEdges }) => {
                setFocusedNodeId(nextNodes[0]?.id);
                setFocusedEdgeId(nextEdges[0]?.id);
              }}
            />
            <Inspector node={selectedNode} edge={selectedNode ? undefined : selectedEdge} nodes={nodes} onUpdateNode={updateNode} onUpdateEdge={updateEdge} />
          </div>
          <ValidationPanel issues={issues} onIssueSelect={selectIssue} />
        </div>
      </div>
      {generatedFiles && <CodeModal files={generatedFiles} onClose={() => setGeneratedFiles(undefined)} />}
      {pendingBoardAction && (
        <div className="confirm-modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">Workspace</p>
            <h2 id="confirm-title">{pendingBoardAction.title}</h2>
            <p>{pendingBoardAction.message}</p>
            <div className="confirm-modal-actions">
              {isDirty && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    if (!saveCurrentProject()) return;
                    pendingBoardAction.action();
                    setPendingBoardAction(undefined);
                  }}
                >
                  Save and continue
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  pendingBoardAction.action();
                  setPendingBoardAction(undefined);
                }}
              >
                Continue without saving
              </button>
              <button type="button" onClick={() => setPendingBoardAction(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
