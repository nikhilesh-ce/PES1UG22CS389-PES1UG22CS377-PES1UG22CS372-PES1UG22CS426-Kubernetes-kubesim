const { Node, Pod } = require('./models');

class NodeManager {
  constructor() {
    this.nodes = new Map();
    this.pods = new Map();
    this.recoveryOperations = new Map();
  }

  // Node Management
  addNode(nodeId, cpuCores) {
    const node = new Node(nodeId, cpuCores);
    this.nodes.set(nodeId, node);
    return node;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getNodes() {
    return Array.from(this.nodes.values()).map(node => ({
      nodeId: node.id,
      cpuCores: node.cpuCores,
      availableCores: node.availableCores,
      status: node.status,
      lastHeartbeat: node.lastHeartbeat ? node.lastHeartbeat.toISOString() : null,
      podCount: node.pods.size
    }));
  }

  // Heartbeat Management
  recordHeartbeat(nodeId, podStatuses = {}, metrics = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    node.lastHeartbeat = new Date();
    node.status = 'healthy';

    if (metrics.cpu) {
      node.metrics = metrics;
    }

    Object.entries(podStatuses).forEach(([podId, status]) => {
      const pod = this.pods.get(podId);
      if (pod) {
        pod.status = status;
        pod.lastUpdated = new Date();
      }
    });

    return true;
  }

  checkNodeHealth() {
    const now = new Date();
    this.nodes.forEach(node => {
      if (node.status !== 'failed' && now - node.lastHeartbeat > 90000) {
        node.status = 'unhealthy';
      }
    });
  }

  // Failure Handling
  handleNodeFailure(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.status = 'failed';
    const pods = this.getPodsOnNode(nodeId);

    pods.forEach(pod => {
      const newNodeId = this.findAvailableNodeForPod(pod.cpuRequired);
      if (newNodeId) {
        this.movePod(pod.id, nodeId, newNodeId);
        this.recordRecoveryOperation(pod.id, nodeId, newNodeId, 'COMPLETED');
      } else {
        this.recordRecoveryOperation(pod.id, nodeId, null, 'FAILED');
      }
    });
  }

  recordRecoveryOperation(podId, fromNodeId, toNodeId, status) {
    this.recoveryOperations.push({
      podId,
      fromNode: fromNodeId,
      toNode: toNodeId,
      status,
      timestamp: new Date()
    });
  }
  
  getRecoveryStatus() {
    // Get all active operations (pending or recently completed)
    return Array.from(this.recoveryOperations.values()).filter(op =>  
      op.status === 'PENDING' || 
      (op.status === 'COMPLETED' && new Date() - op.timestamp < 300000)
    );
  }

  // Pod Management
  addPod(nodeId, podId, cpuRequired, memoryRequired = 0) {
    const node = this.nodes.get(nodeId);
    if (!node || node.availableCores < cpuRequired) return false;
  
    const pod = {
      id: podId,
      nodeId,
      cpuRequired,
      memoryRequired,
      status: 'pending',
      createdAt: new Date()
    };
    
    this.pods.set(podId, pod);
    node.availableCores -= cpuRequired;
    if (!node.pods) node.pods = new Set();
    node.pods.add(podId);

    // Add automatic status update after simulated initialization
    setTimeout(() => {
        if (this.pods.has(podId)) {  // Check if pod still exists
            const pod = this.pods.get(podId);
            pod.status = 'running';
            console.log(`Pod ${podId} is now running on node ${nodeId}`);
            
            // Optional: Update node's last heartbeat time
            node.lastHeartbeat = new Date();
        }
    }, 5000); // 5 second delay to simulate pod initialization

    return pod;
}

  getPodsOnNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    
    return Array.from(node.pods).map(podId => {
      const pod = this.pods.get(podId);
      return {
        id: podId,
        nodeId: pod.nodeId,
        cpuRequired: pod.cpuRequired,
        status: pod.status,
        createdAt: pod.createdAt
      };
    });
  }

  getAllPods() {
    return Array.from(this.pods.values()).map(pod => ({
      id: pod.id,  // Explicitly include ID
      nodeId: pod.nodeId,
      cpuRequired: pod.cpuRequired,
      status: pod.status,
      createdAt: pod.createdAt,
      uptime: Math.floor((new Date() - new Date(pod.createdAt)) / 1000) + 's'
    }));
  }

  movePod(podId, fromNodeId, toNodeId) {
    const pod = this.pods.get(podId);
    if (!pod || pod.nodeId !== fromNodeId) return false;
  
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
  
    if (!fromNode || !toNode || toNode.availableCores < pod.cpuRequired) {
      return false;
    }
  
    fromNode.availableCores += pod.cpuRequired;
    toNode.availableCores -= pod.cpuRequired;
    fromNode.pods.delete(podId);
    toNode.pods.add(podId);
    pod.nodeId = toNodeId;
    pod.status = 'running';
  
    return true;
  }

  removePod(podId) {
    const pod = this.pods.get(podId);
    if (!pod) return false;

    const node = this.nodes.get(pod.nodeId);
    if (node) {
      node.availableCores += pod.cpuRequired;
      node.pods.delete(podId);
    }
    this.pods.delete(podId);
    return true;
  }

  // Scheduling
  findAvailableNodeForPod(cpuRequired) {
    for (const [nodeId, node] of this.nodes) {
      if (node.status === 'healthy' && node.availableCores >= cpuRequired) {
        return nodeId;
      }
    }
    return null;
  }

  simulateNodeFailure(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
  
    node.status = 'failed';
    const pods = this.getPodsOnNode(nodeId);
    const recoveryOperations = [];
  
    pods.forEach(pod => {
      const operation = {
        podId: pod.id,
        fromNode: nodeId,
        toNode: null, // Will be set when moved
        status: 'PENDING',
        timestamp: new Date()
      };
      
      // Immediately attempt relocation
      const newNodeId = this.findAvailableNodeForPod(pod.cpuRequired);
      if (newNodeId) {
        this.movePod(pod.id, nodeId, newNodeId);
        operation.toNode = newNodeId;
        operation.status = 'COMPLETED';
      }
  
      recoveryOperations.push(operation);
      this.recoveryOperations.set(pod.id, operation);
    });
  
    return {
      nodeId,
      status: 'failed',
      recoveryOperations, // Now includes the completed operation
      systemStatus: this.getSystemStatus()
    };
  }
  // Utility Methods
  getAvailableNodes() {
    return new Map(
      [...this.nodes].filter(([_, node]) => 
        node.status === 'healthy' && node.availableCores > 0
      )
    );
  }

  getSystemStatus() {
    const healthyNodes = nodes.filter(n => n.status === 'healthy' && 
                                new Date() - n.lastHeartbeat < 90000);
    const usedCores = pods.reduce((sum,p) => sum + p.cpuRequired, 0);
    return {
      healthyNodes: healthyNodes.length,
      availableCores: totalCores - usedCores
    };
  }
}

module.exports = NodeManager;