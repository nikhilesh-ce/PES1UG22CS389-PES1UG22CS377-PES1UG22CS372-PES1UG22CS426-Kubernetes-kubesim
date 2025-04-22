const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const NodeManager = require('./nodeManager');
const PodScheduler = require('./podScheduler');
const HealthMonitor = require('./healthMonitor');
const Docker = require('dockerode');

const app = express();
const docker = new Docker();
const nodeManager = new NodeManager();
const podScheduler = new PodScheduler(nodeManager);
const healthMonitor = new HealthMonitor(nodeManager, podScheduler);

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Add request ID for tracing
app.use((req, res, next) => {
  req.id = uuidv4();
  next();
});

// Debug route registration
app.on('mount', () => {
  console.log('\nRegistered Endpoints:');
  app._router.stack.forEach(middleware => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).map(m => m.toUpperCase());
      console.log(`${methods.join(',')} ${middleware.route.path}`);
    }
  });
  console.log('\n');
});

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    const nodes = nodeManager.getNodes();
    const pods = [...nodeManager.pods.values()];
    
    const totalCores = nodes.reduce((sum, node) => sum + node.cpuCores, 0);
    const usedCores = pods.reduce((sum, pod) => sum + pod.cpuRequired, 0);
    const healthyNodes = nodes.filter(n => n.status === 'healthy').length;
    
    res.json({
      status: healthyNodes > 0 ? 
        (healthyNodes === nodes.length ? 'healthy' : 'degraded') : 
        'unhealthy',
      timestamp: new Date().toISOString(),
      resources: {
        cpu: {
          total: totalCores,
          allocated: usedCores,
          available: totalCores - usedCores,
          utilization: `${Math.round((usedCores/totalCores)*100)}%`
        }
      },
      nodes: {
        total: nodes.length,
        healthy: healthyNodes,
        unhealthy: nodes.length - healthyNodes,
        breakdown: {
          healthy: nodes.filter(n => n.status === 'healthy').map(n => ({
            id: n.nodeId,
            cpu: `${n.cpuCores - n.availableCores}/${n.cpuCores} cores`,
            lastHeartbeat: n.lastHeartbeat
          })),
          unhealthy: nodes.filter(n => n.status !== 'healthy').map(n => ({
            id: n.nodeId,
            lastHeartbeat: n.lastHeartbeat,
            reason: n.lastHeartbeat ? 
              `No heartbeat for ${Math.floor((new Date() - new Date(n.lastHeartbeat))/1000)}s` :
              'Never received heartbeat'
          }))
        }
      },
      pods: {
        total: pods.length,
        running: pods.filter(p => p.status === 'running').length,
        pending: pods.filter(p => p.status === 'pending').length,
        failed: pods.filter(p => p.status === 'failed').length
      },
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().rss
      }
    });
  } catch (err) {
    console.error(`[${req.id}] Health check failed:`, err);
    res.status(500).json({
      status: 'unavailable',
      error: 'Failed to check cluster health',
      details: err.message,
      requestId: req.id
    });
  }
});

// Node endpoints
app.post('/nodes', async (req, res) => {
  const { cpu_cores } = req.body;

  if (!cpu_cores || isNaN(cpu_cores) || cpu_cores <= 0) {
    return res.status(400).json({ 
      error: 'Invalid input',
      message: 'cpu_cores must be a positive integer',
      requestId: req.id
    });
  }

  try {
    const container = await docker.createContainer({
      Image: 'node-simulator',
      Env: [
        `CPU_CORES=${cpu_cores}`,
        `NODE_ID=${uuidv4()}`,
        `API_SERVER_URL=http://api-server:5000`
      ],
      HostConfig: {
        NetworkMode: 'cluster-network'
      }
    });

    await container.start();
    const nodeId = container.id;
    nodeManager.addNode(nodeId, parseInt(cpu_cores));

    console.log(`[${req.id}] Node ${nodeId} added with ${cpu_cores} cores`);

    res.status(201).json({
      message: 'Node added successfully',
      node_id: nodeId,
      cpu_cores: parseInt(cpu_cores),
      links: {
        details: `/nodes/${nodeId}`,
        health: `/nodes/${nodeId}/health`,
        pods: `/nodes/${nodeId}/pods`
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Node creation failed:`, err);
    res.status(500).json({ 
      error: 'Node creation failed',
      details: err.message,
      requestId: req.id
    });
  }
});

app.get('/nodes', (req, res) => {
  try {
    const nodes = nodeManager.getNodes().map(node => ({
      nodeId: node.nodeId,
      cpuCores: node.cpuCores,
      availableCores: node.availableCores,
      status: node.status,
      lastHeartbeat: node.lastHeartbeat,
      podCount: nodeManager.getPodsOnNode(node.nodeId).length,
      links: {
        details: `/nodes/${node.nodeId}`,
        health: `/nodes/${node.nodeId}/health`,
        pods: `/nodes/${node.nodeId}/pods`
      }
    }));

    res.json({
      nodes,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to list nodes:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/nodes/:id', (req, res) => {
  try {
    const node = nodeManager.nodes.get(req.params.id);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    const pods = nodeManager.getPodsOnNode(req.params.id);
    res.json({
      nodeId: node.id,
      cpu: {
        total: node.cpuCores,
        available: node.availableCores,
        used: node.cpuCores - node.availableCores
      },
      status: node.status,
      lastHeartbeat: node.lastHeartbeat,
      pods: pods.map(pod => ({
        podId: pod.id,
        cpuRequired: pod.cpuRequired,
        status: pod.status,
        uptime: Math.floor((new Date() - new Date(pod.createdAt)) / 1000) + 's',
        links: {
          details: `/pods/${pod.id}`
        }
      })),
      links: {
        health: `/nodes/${node.id}/health`,
        metrics: `/nodes/${node.id}/metrics`
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get node details:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/nodes/:id/health', (req, res) => {
  try {
    const node = nodeManager.nodes.get(req.params.id);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    const now = new Date();
    const lastHeartbeat = new Date(node.lastHeartbeat);
    const secondsSinceHeartbeat = (now - lastHeartbeat) / 1000;

    res.json({
      nodeId: node.id,
      status: node.status,
      lastHeartbeat: node.lastHeartbeat,
      secondsSinceHeartbeat,
      healthStatus: secondsSinceHeartbeat > 60 ? 'critical' : 
                   secondsSinceHeartbeat > 30 ? 'warning' : 'healthy',
      pods: {
        total: nodeManager.getPodsOnNode(node.id).length,
        running: nodeManager.getPodsOnNode(node.id)
          .filter(pod => pod.status === 'running').length
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get node health:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.post('/nodes/:id/heartbeat', (req, res) => {
  try {
    const { id } = req.params;
    const { podStatuses = {}, metrics = {} } = req.body;

    if (nodeManager.recordHeartbeat(id, podStatuses, metrics)) {
      res.json({ 
        message: 'Heartbeat recorded',
        nextHeartbeatDue: new Date(Date.now() + 30000).toISOString(),
        requestId: req.id
      });
    } else {
      res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }
  } catch (err) {
    console.error(`[${req.id}] Heartbeat processing failed:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

// Fault Tolerance Endpoints
app.post('/nodes/:id/simulate-failure', (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = nodeManager.nodes.get(nodeId);
    
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    // Ensure lastHeartbeat is properly set
    node.lastHeartbeat = new Date();
    node.status = 'failed';

    const pods = nodeManager.getPodsOnNode(nodeId);
    const recoveryOperations = pods.map(pod => ({
      podId: pod.id,
      status: 'PENDING'
    }));

    // Immediate rescheduling
    pods.forEach(pod => {
      const newNodeId = podScheduler.schedulePod(pod.cpuRequired);
      if (newNodeId) {
        nodeManager.movePod(pod.id, nodeId, newNodeId);
      }
    });

    res.json({
      message: 'Node failure simulated',
      nodeId,
      status: node.status,
      recoveryOperations,
      systemStatus: healthMonitor.getSystemStatus(),
      requestId: req.id
    });

  } catch (err) {
    console.error(`[${req.id}] Simulation error:`, err);
    res.status(500).json({
      error: 'Failed to simulate failure',
      details: err.message,
      requestId: req.id,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

    

app.get('/recovery-status', (req, res) => {
  try {
    const operations = nodeManager.getRecoveryStatus();
    
    res.json({
      operations: operations.map(op => ({
        podId: op.podId,
        fromNode: op.fromNode,
        toNode: op.toNode,
        status: op.status,
        timestamp: op.timestamp.toISOString()
      })),
      estimatedCompletion: operations.filter(op => op.status === 'PENDING').length * 5,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get recovery status:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});
// Debugging Endpoints
app.get('/nodes/:id/logs', (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = nodeManager.nodes.get(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    const limit = parseInt(req.query.limit) || 10;
    const logs = [
      `[${new Date(Date.now() - 50000).toISOString()}] Node initialized`,
      `[${new Date(Date.now() - 40000).toISOString()}] CPU cores registered: ${node.cpuCores}`,
      `[${new Date(Date.now() - 30000).toISOString()}] Heartbeat system started`,
      `[${new Date(Date.now() - 20000).toISOString()}] Pod scheduling enabled`,
      `[${new Date(Date.now() - 10000).toISOString()}] Health check passed`,
      `[${new Date().toISOString()}] Current status: ${node.status}`
    ].slice(0, limit);

    res.json({
      nodeId,
      logs,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get node logs:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/nodes/:id/metrics', (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = nodeManager.nodes.get(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    const pods = nodeManager.getPodsOnNode(nodeId);
    const usedCores = pods.reduce((sum, pod) => sum + pod.cpuRequired, 0);
    
    res.json({
      nodeId,
      cpu: {
        total: node.cpuCores,
        used: usedCores,
        load: (usedCores / node.cpuCores).toFixed(1)
      },
      memory: {
        total: 8,
        used: 3.2,
        utilization: '40%'
      },
      network: {
        in: 12,
        out: 8
      },
      temperature: 42,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get node metrics:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/metrics', (req, res) => {
  try {
    const nodes = nodeManager.getNodes();
    const pods = [...nodeManager.pods.values()];
    const totalCores = nodes.reduce((sum, node) => sum + node.cpuCores, 0);
    const usedCores = pods.reduce((sum, pod) => sum + pod.cpuRequired, 0);
    
    res.json({
      nodes: {
        total: nodes.length,
        online: nodes.filter(n => n.status === 'healthy').length
      },
      cpu: {
        total: totalCores,
        used: usedCores,
        utilization: `${Math.round((usedCores / totalCores) * 100)}%`
      },
      memory: {
        total: nodes.length * 8,
        used: nodes.length * 3.2,
        utilization: '40%'
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get cluster metrics:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

// Maintenance Endpoints
app.post('/nodes/:id/drain', (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = nodeManager.nodes.get(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    node.status = 'draining';
    const pods = nodeManager.getPodsOnNode(nodeId);
    const evacuatedPods = [];

    pods.forEach(pod => {
      const newNodeId = podScheduler.schedulePod(pod.cpuRequired, pod.memoryRequired);
      if (newNodeId) {
        nodeManager.movePod(pod.id, nodeId, newNodeId);
        evacuatedPods.push({
          id: pod.id,
          newNodeId
        });
      }
    });

    res.json({
      message: 'Node draining initiated',
      nodeId,
      evacuatedPods,
      remainingPods: nodeManager.getPodsOnNode(nodeId).length,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to drain node:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.post('/nodes/:id/repair-complete', (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = nodeManager.nodes.get(nodeId);
    if (!node) {
      return res.status(404).json({ 
        error: 'Node not found',
        requestId: req.id
      });
    }

    node.status = 'healthy';
    node.lastHeartbeat = new Date().toISOString();

    const nodes = nodeManager.getNodes();
    const healthyNodes = nodes.filter(n => n.status === 'healthy').length;

    res.json({
      message: 'Node repair completed',
      nodeId,
      availableCores: node.availableCores,
      clusterStatus: healthyNodes === nodes.length ? 'healthy' : 'degraded',
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to complete node repair:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

// Pod endpoints
app.post('/pods', async (req, res) => {
  const { cpu_required, memory_required } = req.body;
  
  if (!cpu_required || cpu_required <= 0) {
    return res.status(400).json({ 
      error: 'Invalid input',
      message: 'cpu_required must be a positive number',
      requestId: req.id
    });
  }

  try {
    const nodeId = podScheduler.schedulePod(cpu_required, memory_required);
    if (!nodeId) {
      return res.status(400).json({ 
        error: 'Insufficient resources',
        message: 'No nodes available with sufficient resources',
        requestId: req.id,
        required: {
          cpu: cpu_required,
          memory: memory_required || 'N/A'
        },
        availableNodes: nodeManager.getAvailableNodes().map(n => ({
          nodeId: n.nodeId,
          availableCpu: n.availableCores,
          availableMemory: n.availableMemory || 'N/A'
        }))
      });
    }

    const podId = `pod-${uuidv4()}`;
    nodeManager.addPod(nodeId, podId, cpu_required, memory_required);

    console.log(`[${req.id}] Pod ${podId} launched on node ${nodeId}`);

    res.status(201).json({
      message: 'Pod launched successfully',
      pod_id: podId,
      node_id: nodeId,
      cpu_required,
      memory_required: memory_required || null,
      links: {
        node: `/nodes/${nodeId}`,
        pod: `/pods/${podId}`,
        logs: `/pods/${podId}/logs`
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Pod launch failed:`, err);
    res.status(500).json({ 
      error: 'Pod launch failed',
      details: err.message,
      requestId: req.id
    });
  }
});

app.get('/pods', (req, res) => {
  try {
    const pods = nodeManager.getAllPods().map(pod => ({
      id: pod.id,  // Ensure ID is included
      nodeId: pod.nodeId,
      cpuRequired: pod.cpuRequired,
      status: pod.status,
      uptime: pod.uptime,
      createdAt: pod.createdAt,
      links: {
        details: `/pods/${pod.id}`,
        logs: `/pods/${pod.id}/logs`
      }
    }));


    res.json({
      pods,
      total: pods.length,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to list pods:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/pods/:id', (req, res) => {
  try {
    const pod = nodeManager.pods.get(req.params.id);
    if (!pod) {
      return res.status(404).json({ 
        error: 'Pod not found',
        requestId: req.id
      });
    }

    const node = nodeManager.nodes.get(pod.nodeId);
    res.json({
      podId: pod.id,
      nodeId: pod.nodeId,
      cpuRequired: pod.cpuRequired,
      memoryRequired: pod.memoryRequired || null,
      status: pod.status,
      createdAt: pod.createdAt,
      uptime: Math.floor((new Date() - new Date(pod.createdAt)) / 1000) + 's',
      node: {
        status: node?.status,
        availableCores: node?.availableCores,
        availableMemory: node?.availableMemory
      },
      events: pod.events || [],
      links: {
        node: `/nodes/${pod.nodeId}`,
        logs: `/pods/${pod.id}/logs`
      },
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get pod details:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.get('/pods/:id/logs', (req, res) => {
  try {
    const pod = nodeManager.pods.get(req.params.id);
    if (!pod) {
      return res.status(404).json({ 
        error: 'Pod not found',
        requestId: req.id
      });
    }

    const logs = [
      `[${new Date(Date.now() - 10000).toISOString()}] Pod initialized`,
      `[${new Date(Date.now() - 8000).toISOString()}] CPU allocated: ${pod.cpuRequired} cores`,
      `[${new Date(Date.now() - 5000).toISOString()}] Started main process`,
      `[${new Date().toISOString()}] Health check passed`
    ];

    res.json({
      podId: pod.id,
      logs,
      requestId: req.id
    });
  } catch (err) {
    console.error(`[${req.id}] Failed to get pod logs:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

app.delete('/pods/:id', (req, res) => {
  try {
    const podId = req.params.id;
    if (!nodeManager.pods.has(podId)) {
      return res.status(404).json({ 
        error: 'Pod not found',
        requestId: req.id
      });
    }

    const pod = nodeManager.pods.get(podId);
    const success = nodeManager.removePod(podId);

    if (success) {
      console.log(`[${req.id}] Pod ${podId} deleted from node ${pod.nodeId}`);
      res.json({
        message: 'Pod deleted successfully',
        podId,
        nodeId: pod.nodeId,
        releasedResources: {
          cpu: pod.cpuRequired,
          memory: pod.memoryRequired || null
        },
        requestId: req.id
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to delete pod',
        requestId: req.id
      });
    }
  } catch (err) {
    console.error(`[${req.id}] Failed to delete pod:`, err);
    res.status(500).json({ 
      error: 'Internal server error',
      requestId: req.id
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(`[${req.id}] Unhandled error:`, err);
  res.status(500).json({ 
    error: 'Internal server error',
    requestId: req.id
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`API Server running on port ${PORT}`);
  console.log(`Health monitor interval: ${healthMonitor.heartbeatInterval/1000}s`);
});