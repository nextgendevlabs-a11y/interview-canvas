export interface PaletteComponent {
  type: string;
  label: string;
  category: string;
  default_width: number;
  default_height: number;
  color: string;
  icon: string;
}

export const PALETTE_CATEGORIES = [
  'General',
  'Data',
  'Messaging',
  'Network',
  'Compute',
  'AI',
] as const;

export const PALETTE: PaletteComponent[] = [
  // General
  { type: 'service', label: 'Service', category: 'General', default_width: 160, default_height: 80, color: '#3b82f6', icon: 'square' },
  { type: 'rounded', label: 'Process', category: 'General', default_width: 160, default_height: 80, color: '#6366f1', icon: 'rounded' },
  { type: 'text', label: 'Text', category: 'General', default_width: 120, default_height: 40, color: '#1e293b', icon: 'text' },
  { type: 'sticky', label: 'Sticky Note', category: 'General', default_width: 140, default_height: 120, color: '#fbbf24', icon: 'sticky' },
  { type: 'boundary', label: 'Boundary', category: 'General', default_width: 280, default_height: 200, color: '#94a3b8', icon: 'boundary' },
  { type: 'icon', label: 'Icon', category: 'General', default_width: 64, default_height: 64, color: '#64748b', icon: 'star' },
  // Data
  { type: 'rds', label: 'Relational DB', category: 'Data', default_width: 140, default_height: 90, color: '#0ea5e9', icon: 'database' },
  { type: 'nosql', label: 'NoSQL DB', category: 'Data', default_width: 140, default_height: 90, color: '#10b981', icon: 'database' },
  { type: 'cache', label: 'Cache', category: 'Data', default_width: 120, default_height: 80, color: '#f97316', icon: 'cache' },
  { type: 'storage', label: 'Object Storage', category: 'Data', default_width: 140, default_height: 90, color: '#8b5cf6', icon: 'storage' },
  { type: 'warehouse', label: 'Data Warehouse', category: 'Data', default_width: 160, default_height: 90, color: '#0891b2', icon: 'warehouse' },
  // Messaging
  { type: 'queue', label: 'Queue', category: 'Messaging', default_width: 140, default_height: 70, color: '#eab308', icon: 'queue' },
  { type: 'stream', label: 'Event Stream', category: 'Messaging', default_width: 160, default_height: 70, color: '#f59e0b', icon: 'stream' },
  { type: 'pubsub', label: 'Pub/Sub Broker', category: 'Messaging', default_width: 140, default_height: 80, color: '#d97706', icon: 'pubsub' },
  // Network
  { type: 'client', label: 'Client', category: 'Network', default_width: 120, default_height: 80, color: '#3b82f6', icon: 'client' },
  { type: 'browser', label: 'Browser/Mobile', category: 'Network', default_width: 120, default_height: 80, color: '#2563eb', icon: 'browser' },
  { type: 'gateway', label: 'API Gateway', category: 'Network', default_width: 140, default_height: 70, color: '#6366f1', icon: 'gateway' },
  { type: 'loadbalancer', label: 'Load Balancer', category: 'Network', default_width: 140, default_height: 60, color: '#4f46e5', icon: 'loadbalancer' },
  { type: 'cdn', label: 'CDN', category: 'Network', default_width: 120, default_height: 70, color: '#7c3aed', icon: 'cdn' },
  { type: 'external_api', label: 'External API', category: 'Network', default_width: 130, default_height: 70, color: '#64748b', icon: 'external' },
  // Compute
  { type: 'server', label: 'Server', category: 'Compute', default_width: 130, default_height: 80, color: '#10b981', icon: 'server' },
  { type: 'worker', label: 'Worker', category: 'Compute', default_width: 120, default_height: 80, color: '#059669', icon: 'worker' },
  { type: 'function', label: 'Function/Serverless', category: 'Compute', default_width: 130, default_height: 70, color: '#14b8a6', icon: 'function' },
  { type: 'container', label: 'Container/Cluster', category: 'Compute', default_width: 140, default_height: 80, color: '#0d9488', icon: 'container' },
  // AI
  { type: 'llm', label: 'LLM/Model', category: 'AI', default_width: 130, default_height: 80, color: '#8b5cf6', icon: 'llm' },
  { type: 'embedding', label: 'Embedding Model', category: 'AI', default_width: 140, default_height: 70, color: '#a78bfa', icon: 'embedding' },
  { type: 'vector_db', label: 'Vector Database', category: 'AI', default_width: 130, default_height: 90, color: '#7c3aed', icon: 'vector' },
  { type: 'agent', label: 'Agent/Tool', category: 'AI', default_width: 120, default_height: 80, color: '#9333ea', icon: 'agent' },
];

export function getPaletteComponent(type: string): PaletteComponent | undefined {
  return PALETTE.find((c) => c.type === type);
}

export const PARTICIPANT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f97316',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#6366f1',
  '#ef4444',
  '#0891b2',
];
