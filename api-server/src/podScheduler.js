class PodScheduler {
    constructor(nodeManager) {
      this.nodeManager = nodeManager;
    }
  
    // First-fit algorithm (simplest approach)
    schedulePod(cpuRequired) {
      const nodes = this.nodeManager.getAvailableNodes();
      
      for (const [nodeId, node] of nodes) {
        if (node.availableCores >= cpuRequired) {
          return nodeId;
        }
      }
      return null; // No available nodes
    }
  }
  
  module.exports = PodScheduler;