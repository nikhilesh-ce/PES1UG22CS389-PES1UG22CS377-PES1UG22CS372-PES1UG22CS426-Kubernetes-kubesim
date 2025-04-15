const axios = require('axios');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://api-server:5000';
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL) || 10000; // Default 10 seconds
const MAX_RETRY_ATTEMPTS = 5;

class NodeSimulator {
  constructor() {
    this.cpuCores = parseInt(process.env.CPU_CORES) || 2;
    this.nodeId = process.env.NODE_ID || uuidv4();
    this.pods = new Map(); // podId -> { status, cpuUsage, lastActivity }
    this.retryAttempts = 0;
    this.heartbeatInterval = HEARTBEAT_INTERVAL;
    this.isShuttingDown = false;
  }

  async start() {
    console.log(`Starting node ${this.nodeId} with ${this.cpuCores} CPU cores`);
    this.registerNode();
    this.startHeartbeat();
  }

  async registerNode() {
    try {
      await axios.post(`${API_SERVER_URL}/nodes/register`, {
        nodeId: this.nodeId,
        cpuCores: this.cpuCores,
        initialPods: Array.from(this.pods.keys())
      });
      console.log(`Node ${this.nodeId} registered successfully`);
    } catch (err) {
      console.error('Node registration failed:', err.message);
      setTimeout(() => this.registerNode(), 5000); // Retry after 5 seconds
    }
  }

  startHeartbeat() {
    if (this.isShuttingDown) return;
    
    setTimeout(async () => {
      await this.sendHeartbeat();
      this.startHeartbeat(); // Schedule next heartbeat
    }, this.heartbeatInterval);
  }

  async sendHeartbeat() {
    try {
      if (!this.nodeId || this.isShuttingDown) return;

      // Prepare system metrics
      const systemMetrics = {
        cpu: {
          load: os.loadavg()[0], // 1-minute average
          cores: os.cpus().length
        },
        memory: {
          total: os.totalmem(),
          free: os.freemem()
        },
        uptime: os.uptime()
      };

      // Prepare pod status report
      const podReport = {};
      this.pods.forEach((pod, podId) => {
        podReport[podId] = {
          status: pod.status || 'running',
          cpuUsage: pod.cpuUsage || 0,
          memoryUsage: pod.memoryUsage || 0,
          lastActivity: pod.lastActivity || new Date().toISOString()
        };
      });

      const heartbeatData = {
        timestamp: new Date().toISOString(),
        nodeStatus: {
          ready: true,
          resources: {
            availableCpu: this.cpuCores - Array.from(this.pods.values())
                              .reduce((sum, pod) => sum + (pod.cpuUsage || 0), 0),
            totalCpu: this.cpuCores
          }
        },
        podStatuses: podReport,
        systemMetrics
      };

      const response = await axios.post(
        `${API_SERVER_URL}/nodes/${this.nodeId}/heartbeat`,
        heartbeatData,
        { timeout: 8000 } // 8 second timeout
      );

      // Reset retry attempts on success
      this.retryAttempts = 0;

      // Adjust heartbeat interval if server suggests it
      if (response.data?.recommendedInterval) {
        this.heartbeatInterval = Math.max(
          5000, // Minimum 5 seconds
          Math.min(
            response.data.recommendedInterval,
            60000 // Maximum 1 minute
          )
        );
      }

      console.debug(`Heartbeat acknowledged for ${this.nodeId}`, {
        timestamp: heartbeatData.timestamp,
        nextHeartbeatIn: `${this.heartbeatInterval/1000}s`,
        podsReported: Object.keys(podReport).length
      });

    } catch (err) {
      console.error('Heartbeat failed:', {
        error: err.message,
        attempt: this.retryAttempts + 1,
        timestamp: new Date().toISOString()
      });

      if (this.retryAttempts < MAX_RETRY_ATTEMPTS) {
        this.retryAttempts++;
        const retryDelay = Math.min(
          60000, // Max 1 minute
          Math.pow(2, this.retryAttempts) * 1000 // Exponential backoff
        );
        setTimeout(() => this.sendHeartbeat(), retryDelay);
      } else {
        console.error('Max heartbeat retries reached. Node may be marked as unhealthy.');
      }
    }
  }

  async shutdown() {
    this.isShuttingDown = true;
    console.log(`Shutting down node ${this.nodeId}`);
    
    try {
      await axios.post(`${API_SERVER_URL}/nodes/${this.nodeId}/shutdown`, {
        timestamp: new Date().toISOString(),
        reason: 'Node shutdown requested'
      });
    } catch (err) {
      console.error('Graceful shutdown failed:', err.message);
    }
  }

  // Simulate pod creation (for testing)
  simulatePod(podId, cpuUsage = 0.5) {
    this.pods.set(podId, {
      status: 'running',
      cpuUsage,
      lastActivity: new Date().toISOString()
    });
    return podId;
  }
}

// Handle process termination
process.on('SIGTERM', () => {
  node.shutdown().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  node.shutdown().finally(() => process.exit(0));
});

const node = new NodeSimulator();
node.start();

// For testing/demo purposes
if (process.env.NODE_ENV === 'development') {
  // Simulate a pod after 5 seconds
  setTimeout(() => {
    const podId = `pod-${uuidv4()}`;
    node.simulatePod(podId, 0.7);
    console.log(`Simulated pod ${podId} created`);
  }, 5000);
}

module.exports = NodeSimulator;