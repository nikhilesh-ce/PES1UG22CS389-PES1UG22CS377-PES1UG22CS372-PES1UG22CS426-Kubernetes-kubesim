// api-server/src/models.js
class Node {
    constructor(id, cpuCores) {
      this.id = id;
      this.cpuCores = cpuCores;
      this.availableCores = cpuCores;
      this.lastHeartbeat = new Date();
      this.status = 'healthy';
      this.pods = new Set();
    }
  }
  
  class Pod {
    constructor(id, nodeId, cpuRequired) {
      this.id = id;
      this.nodeId = nodeId;
      this.cpuRequired = cpuRequired;
      this.status = 'running';
      this.createdAt = new Date();
    }
  }
  
  module.exports = { Node, Pod };