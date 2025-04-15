const { Node, Pod } = require('./models');

class NodeManager {
  constructor() {
    this.nodes = new Map(); // nodeId -> Node instance
    this.pods = new Map();  // podId -> Pod instance
  }

  addNode(nodeId, cpuCores) {
    const node = new Node(nodeId, cpuCores);
    this.nodes.set(nodeId, node);
    return nodeId;
  }

  getNodes() {
    this.checkNodeHealth();
    return Array.from(this.nodes.entries()).map(([nodeId, node]) => ({
      nodeId,
      cpuCores: node.cpuCores,
      availableCores: node.availableCores,
      status: node.status,
      lastHeartbeat: node.lastHeartbeat.toISOString(),
      podCount: node.pods.size
    }));
  }

  recordHeartbeat(nodeId, podStatuses = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    node.lastHeartbeat = new Date();
    node.status = 'healthy';

    // Update pod statuses from heartbeat
    Object.entries(podStatuses).forEach(([podId, status]) => {
      if (this.pods.has(podId)) {
        this.pods.get(podId).status = status;
      }
    });

    return true;
  }

  checkNodeHealth() {
    const now = new Date();
    const unhealthyThreshold = new Date(now - 60000); // 60s timeout

    this.nodes.forEach((node, nodeId) => {
      if (node.lastHeartbeat < unhealthyThreshold) {
        node.status = 'unhealthy';
      }
    });
  }

  // Pod-related methods
  getAvailableNodes() {
    return new Map(
      [...this.nodes].filter(([_, node]) => 
        node.status === 'healthy' && node.availableCores > 0
      )
    );
  }

  addPod(nodeId, podId, cpuRequired) {
    const node = this.nodes.get(nodeId);
    if (!node || node.availableCores < cpuRequired) return false;

    const pod = new Pod(podId, nodeId, cpuRequired);
    node.availableCores -= cpuRequired;
    node.pods.add(podId);
    this.pods.set(podId, pod);
    return true;
  }

  getPodsOnNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    
    return Array.from(node.pods).map(podId => ({
      id: podId,
      ...this.pods.get(podId)
    }));
  }

  movePod(podId, fromNodeId, toNodeId) {
    const pod = this.pods.get(podId);
    if (!pod || pod.nodeId !== fromNodeId) return false;
  
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
  
    if (!fromNode || !toNode) return false;
  
    // Update resource availability
    fromNode.availableCores += pod.cpuRequired;
    toNode.availableCores -= pod.cpuRequired;
  
    // Move the pod
    pod.nodeId = toNodeId;
    pod.status = 'running'; // Reset status
  
    return true;
  }

  simulateNodeFailure(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    // Mark node as failed
    node.status = 'failed';
    node.lastHeartbeat = new Date().toISOString();

    // Get pods to reschedule
    const pods = this.getPodsOnNode(nodeId);
    const recoveryOperations = [];

    pods.forEach(pod => {
      recoveryOperations.push({
        podId: pod.id,
        fromNode: nodeId,
        status: 'PENDING'
      });
    });

    return {
      nodeId,
      status: 'failed',
      recoveryOperations
    };
  }

  getRecoveryOperations() {
    // In a real implementation, this would track ongoing operations
    return this.recoveryOperations || []
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
}

module.exports = NodeManager;