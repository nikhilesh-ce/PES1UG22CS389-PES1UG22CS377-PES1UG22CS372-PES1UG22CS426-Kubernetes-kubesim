class HealthMonitor {
  constructor(nodeManager, podScheduler) {
    this.nodeManager = nodeManager;
    this.podScheduler = podScheduler;
    this.heartbeatInterval = setInterval(
      this.checkNodeHealth.bind(this), 
      30000 // Check every 30 seconds
    );
  }

  checkNodeHealth() {
    const now = new Date();
    const unhealthyThreshold = new Date(now - 90000); // 60s timeout
    
    this.nodeManager.nodes.forEach((node, nodeId) => {
      if (node.lastHeartbeat < unhealthyThreshold && node.status !== 'unhealthy') {
        console.log(`Node ${nodeId} marked as unhealthy`);
        node.status = 'unhealthy';
        this.handleNodeFailure(nodeId);
      }
    });
  }

  getSystemStatus() {
    const nodes = this.nodeManager.getNodes();
    const healthyNodes = nodes.filter(n => n.status === 'healthy').length;
    
    return {
      status: healthyNodes === nodes.length ? 'healthy' :
             healthyNodes >= nodes.length / 2 ? 'degraded' : 'critical',
      totalNodes: nodes.length,
      healthyNodes,
      recoveringNodes: nodes.filter(n => n.status === 'failed').length
    };
  }

  handleNodeFailure(nodeId) {
    const pods = this.nodeManager.getPodsOnNode(nodeId);
    console.log(`Rescheduling ${pods.length} pods from failed node ${nodeId}`);
    
    pods.forEach(pod => {
      const newNodeId = this.podScheduler.schedulePod(pod.cpuRequired);
      if (newNodeId) {
        this.nodeManager.movePod(pod.id, nodeId, newNodeId);
        console.log(`Pod ${pod.id} rescheduled to node ${newNodeId}`);
      } else {
        console.log(`Failed to reschedule pod ${pod.id}, no available nodes`);
      }
    });
  }
}

module.exports = HealthMonitor;