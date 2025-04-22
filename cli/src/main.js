#!/usr/bin/env node
import { Command } from 'commander';
import axios from 'axios';
import inquirer from 'inquirer';

const program = new Command();
const API_SERVER_URL = 'http://localhost:5000';

program
  .name('cluster-cli')
  .description('CLI for managing the distributed cluster')
  .version('1.0.0');

// Helper function for consistent error handling
const handleError = (err) => {
  console.error('Error:', 
    err.response?.data?.error || 
    err.response?.data?.message || 
    err.message || 
    'Unknown error occurred'
  );
  if (err.response) {
    console.debug('Response status:', err.response.status);
    console.debug('Response data:', err.response.data);
  }
};

program.command('add-node')
  .description('Add a new node to the cluster')
  .option('-c, --cpu-cores <number>', 'Number of CPU cores')
  .action(async (options) => {
    try {
      const cpuCores = options.cpuCores || (await inquirer.prompt([
        {
          type: 'number',
          name: 'cpuCores',
          message: 'Enter CPU cores for the node:',
          validate: input => input > 0 || 'Must be a positive number',
          default: 1
        }
      ])).cpuCores;

      const response = await axios.post(`${API_SERVER_URL}/nodes`, {
        cpu_cores: cpuCores || 1
      });

      console.log('Node added successfully:');
      console.log(`ID: ${response.data.node_id || 'unknown-id'}`);
      console.log(`CPU Cores: ${response.data.cpu_cores || cpuCores || 1}`);
      console.log(`Status: ${response.data.status || 'active'}`);
    } catch (err) {
      handleError(err);
    }
  });

program.command('list-nodes')
  .description('List all nodes in the cluster')
  .action(async () => {
    try {
      const response = await axios.get(`${API_SERVER_URL}/nodes`);
      
      const nodes = Array.isArray(response.data) 
        ? response.data 
        : response.data?.nodes || [];

      if (nodes.length === 0) {
        console.log('No nodes in the cluster');
        return;
      }

      console.log('Cluster Nodes:');
      nodes.forEach(node => {
        console.log(`ID: ${node.nodeId || node.node_id || 'unknown-id'}`);
        console.log(`CPU Cores: ${node.cpuCores || node.cpu_cores || 0} (Available: ${node.availableCores || node.available_cores || 0})`);
        console.log(`Status: ${node.status || 'unknown'}`);
        console.log(`Last Heartbeat: ${node.lastHeartbeat || node.last_heartbeat || 'never'}`);
        console.log('-'.repeat(40));
      });
    } catch (err) {
      handleError(err);
    }
  });

program.command('launch-pod')
  .description('Launch a new pod')
  .requiredOption('-c, --cpu-required <number>', 'CPU cores required')
  .action(async (options) => {
    try {
      const cpuRequired = parseInt(options.cpuRequired) || 1;
      const response = await axios.post(`${API_SERVER_URL}/pods`, {
        cpu_required: cpuRequired
      });

      console.log('Pod launched:');
      console.log(`ID: ${response.data.pod_id || 'unknown-id'}`);
      console.log(`Node: ${response.data.node_id || 'unassigned'}`);
      console.log(`CPU: ${response.data.cpu_required || cpuRequired}`);
      console.log(`Status: ${response.data.status || 'pending'}`);
    } catch (err) {
      handleError(err);
    }
  });

program.command('list-pods')
  .description('List all pods in the cluster')
  .action(async () => {
    try {
      const response = await axios.get(`${API_SERVER_URL}/pods`);
      
      let pods = [];
      if (Array.isArray(response.data)) {
        if (response.data.length > 0 && Array.isArray(response.data[0])) {
          // Nested array format: [ [id, {details}], ... ]
          pods = response.data.map(podEntry => ({
            id: podEntry[0] || 'unknown-id',
            nodeId: podEntry[1]?.nodeId || podEntry[1]?.node_id || 'unassigned',
            cpuRequired: podEntry[1]?.cpuRequired || podEntry[1]?.cpu_required || 0,
            status: podEntry[1]?.status || 'pending',
            createdAt: podEntry[1]?.createdAt || new Date().toISOString(),
            uptime: podEntry[1]?.uptime || '0s'
          }));
        } else {
          // Flat array format
          pods = response.data.map(pod => ({
            id: pod.id || pod.pod_id || 'unknown-id',
            nodeId: pod.nodeId || pod.node_id || 'unassigned',
            cpuRequired: pod.cpuRequired || pod.cpu_required || 0,
            status: pod.status || 'pending',
            createdAt: pod.createdAt || new Date().toISOString(),
            uptime: pod.uptime || '0s'
          }));
        }
      } else if (response.data?.pods) {
        // Object with pods array
        pods = response.data.pods.map(pod => ({
          id: pod.id || pod.pod_id || 'unknown-id',
          nodeId: pod.nodeId || pod.node_id || 'unassigned',
          cpuRequired: pod.cpuRequired || pod.cpu_required || 0,
          status: pod.status || 'pending',
          createdAt: pod.createdAt || new Date().toISOString(),
          uptime: pod.uptime || '0s'
        }));
      }

      if (pods.length === 0) {
        console.log('No pods in the cluster');
        return;
      }
      
      console.log('Cluster Pods:');
      pods.forEach(pod => {
        console.log(`ID: ${pod.id}`);
        console.log(`Node: ${pod.nodeId}`);
        console.log(`CPU: ${pod.cpuRequired} cores`);
        console.log(`Status: ${pod.status}`);
        console.log(`Uptime: ${pod.uptime}`);
        console.log(`Created: ${new Date(pod.createdAt).toLocaleString()}`);
        console.log('-'.repeat(40));
      });
    } catch (err) {
      handleError(err);
    }
  });

program.command('pod-info <podId>')
  .description('Get detailed information about a pod')
  .action(async (podId) => {
    try {
      // First try getting all pods
      const response = await axios.get(`${API_SERVER_URL}/pods`);
      let pod = null;

      // Search through response formats
      if (Array.isArray(response.data)) {
        if (response.data.length > 0 && Array.isArray(response.data[0])) {
          // Nested array format
          const found = response.data.find(entry => entry[0] === podId);
          if (found) {
            pod = {
              id: found[0],
              ...found[1],
              status: found[1]?.status || 'running',
              uptime: found[1]?.uptime || '0s',
              createdAt: found[1]?.createdAt || new Date().toISOString()
            };
          }
        } else {
          // Flat array format
          pod = response.data.find(p => p.id === podId || p.pod_id === podId);
        }
      } else if (response.data?.pods) {
        // Object with pods array
        pod = response.data.pods.find(p => p.id === podId || p.pod_id === podId);
      }

      if (!pod) {
        console.error(`Pod with ID ${podId} not found`);
        return;
      }

      console.log('Pod Details:');
      console.log(`ID: ${pod.id || podId}`);
      console.log(`Node: ${pod.nodeId || pod.node_id || 'unassigned'}`);
      console.log(`CPU Required: ${pod.cpuRequired || pod.cpu_required || 0} cores`);
      console.log(`Status: ${pod.status || 'unknown'}`);
      console.log(`Uptime: ${pod.uptime || '0s'}`);
      console.log(`Created At: ${pod.createdAt ? new Date(pod.createdAt).toLocaleString() : 'Unknown'}`);
    } catch (err) {
      handleError(err);
    }
  });


  program
  .command('check-health')
  .description('Check the overall health status of the cluster')
  .action(async () => {
    try {
      // Get health status directly from the health endpoint
      const healthResponse = await axios.get(`${API_SERVER_URL}/health`);
      const healthData = healthResponse.data;

      // Get detailed nodes and pods data
      const nodesResponse = await axios.get(`${API_SERVER_URL}/nodes`);
      const podsResponse = await axios.get(`${API_SERVER_URL}/pods`);

      // Process nodes data
      const nodes = nodesResponse.data.nodes || nodesResponse.data;
      const healthyNodes = nodes.filter(node => node.status === 'healthy').length;
      const totalNodes = nodes.length;

      // Process pods data - handle both array and object formats
      let pods = [];
      if (Array.isArray(podsResponse.data)) {
        pods = podsResponse.data.map(entry => 
          Array.isArray(entry) ? { id: entry[0], ...entry[1] } : entry
        );
      } else if (podsResponse.data?.pods) {
        pods = podsResponse.data.pods;
      }

      const runningPods = pods.filter(pod => pod.status === 'running').length;
      const pendingPods = pods.filter(pod => pod.status === 'pending').length;

      // Format the output
      console.log(`Cluster Status: ${healthData.status.toUpperCase()}`);
      console.log(`Nodes: ${healthyNodes}/${totalNodes} operational`);
      console.log(`Resources: ${healthData.resources.cpu.available}/${healthData.resources.cpu.total} cores (${healthData.resources.cpu.utilization}) available`);
      console.log(`Pods: ${runningPods} running, ${pendingPods} pending`);
      console.log(`Last Check: ${new Date().toISOString()}`);

      // Set appropriate exit code
      process.exitCode = healthData.status === 'healthy' ? 0 : 
                         healthData.status === 'degraded' ? 1 : 2;
    } catch (err) {
      console.error('Error checking cluster health:');
      if (err.response) {
        console.error(`HTTP ${err.response.status}: ${err.response.statusText}`);
        if (err.response.data) {
          console.error(JSON.stringify(err.response.data, null, 2));
        }
      } else {
        console.error(err.message);
      }
      process.exitCode = 3;
    }
  });

program
  .command('node-info <nodeId>')
  .description('Get detailed information about a node')
  .action(async (nodeId) => {
    try {
      // First try the direct node endpoint
      let nodeData;
      try {
        const response = await axios.get(`${API_SERVER_URL}/nodes/${nodeId}`);
        nodeData = response.data;
      } catch (err) {
        if (err.response?.status === 404) {
          // If direct endpoint fails, get all nodes and filter
          const allNodesResponse = await axios.get(`${API_SERVER_URL}/nodes`);
          const allNodes = allNodesResponse.data.nodes || allNodesResponse.data;
          nodeData = allNodes.find(n => n.nodeId === nodeId || n.id === nodeId);
          
          if (!nodeData) {
            throw new Error(`Node ${nodeId} not found`);
          }
        } else {
          throw err;
        }
      }

      // Get all pods to find those on this node
      const podsResponse = await axios.get(`${API_SERVER_URL}/pods`);
      let podEntries = Array.isArray(podsResponse.data) ? podsResponse.data : [];
      
      // Normalize pod data format
      const nodePods = podEntries
        .map(entry => {
          if (Array.isArray(entry)) {
            return { id: entry[0], ...entry[1] }; // Handle [id, details] format
          }
          return entry; // Handle object format
        })
        .filter(pod => pod.nodeId === nodeId || pod.node_id === nodeId);

      // Format the output
      console.log(`Node ID: ${nodeId}`);
      console.log(`Status: ${nodeData.status || 'unknown'}`);
      console.log(`CPU: ${(nodeData.cpuCores || 0) - (nodeData.availableCores || 0)}/${nodeData.cpuCores || 0} cores used`);
      
      if (nodePods.length > 0) {
        console.log('Pods:');
        nodePods.forEach(pod => {
          const status = pod.status || 'unknown';
          const cores = pod.cpuRequired || pod.cpu_required || 0;
          console.log(`  - ${pod.id} (${cores} core${cores !== 1 ? 's' : ''}, ${status})`);
        });
      } else {
        console.log('Pods: None');
      }

      console.log(`Last Heartbeat: ${nodeData.lastHeartbeat || 'Never'}`);

    } catch (err) {
      console.error('Error fetching node information:');
      if (err.response) {
        console.error(`HTTP ${err.response.status}: ${err.response.statusText}`);
        if (err.response.data) {
          console.error(JSON.stringify(err.response.data, null, 2));
        }
      } else {
        console.error(err.message);
      }
      process.exitCode = 1;
    }
  });

// Fault Tolerance Commands
program
  .command('simulate-failure')
  .description('Simulate node failure and trigger recovery procedures')
  .requiredOption('--node <nodeId>', 'ID of the node to simulate failure')
  .option('--verbose', 'Show detailed output')
  .action(async (options) => {
    try {
      if (options.verbose) {
        console.log('Making API request to simulate failure...');
      }

      const response = await axios.post(
        `${API_SERVER_URL}/nodes/${options.node}/simulate-failure`,
        {},
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (options.verbose) {
        console.log('API Response:', JSON.stringify(response.data, null, 2));
      }

      console.log(`\nSimulating failure on node ${options.node}...`);
      console.log('Recovery operations initiated:');
      
      if (response.data.recoveryOperations && response.data.recoveryOperations.length > 0) {
        response.data.recoveryOperations.forEach(op => {
          console.log(`- Pod ${op.podId}: ${op.status}`);
          if (op.toNode) {
            console.log(`  ↳ Moving to node ${op.toNode}`);
          } else if (op.status === 'FAILED') {
            console.log(`  ↳ No available nodes with sufficient resources`);
          }
        });
      } else {
        console.log('- No pods to reschedule');
      }

      console.log('\nSystem status after failure:');
      const status = response.data.systemStatus || {};
      console.log(`- Cluster status: ${status.status?.toUpperCase() || 'UNKNOWN'}`);
      console.log(`- Healthy nodes: ${status.healthyNodes || 0}/${status.totalNodes || 0}`);
      console.log(`- Pods being recovered: ${status.recoveringNodes || 0}`);

      console.log('\nNext steps:');
      console.log('1. Run "cluster-cli recovery-status" to monitor progress');
      console.log('2. Run "cluster-cli list-pods" to verify pod relocation');
      console.log('3. Run "cluster-cli list-nodes" to check node statuses\n');

    } catch (err) {
      console.error('\nError simulating node failure:');
      if (err.response) {
        console.error(`- HTTP Status: ${err.response.status}`);
        if (err.response.data) {
          console.error('- Server response:');
          console.error(JSON.stringify(err.response.data, null, 2));
        }
      } else {
        console.error(`- ${err.message}`);
      }
      console.error('\nTroubleshooting tips:');
      console.error('1. Verify the node exists: cluster-cli list-nodes');
      console.error('2. Check API server logs: docker logs <api-container>');
      process.exitCode = 1;
    }
  });

  program
  .command('recovery-status')
  .description('Check status of ongoing recovery operations')
  .action(async () => {
    try {
      const response = await axios.get(`${API_SERVER_URL}/recovery-status`);
      
      if (!response.data.operations || response.data.operations.length === 0) {
        console.log('No active recovery operations');
        return;
      }

      console.log('Active Recovery Operations:');
      console.log('='.repeat(60));
      response.data.operations.forEach((op, idx) => {
        console.log(`${idx + 1}. Pod: ${op.podId}`);
        console.log(`   Status: ${op.status}`);
        console.log(`   From Node: ${op.fromNode}`);
        console.log(`   To Node: ${op.toNode || 'Not yet assigned'}`);
        console.log(`   Timestamp: ${op.timestamp}`);
        console.log('-'.repeat(60));
      });

      if (response.data.estimatedCompletion > 0) {
        console.log(`\nEstimated time remaining: ${response.data.estimatedCompletion} seconds`);
      }
    } catch (err) {
      console.error('Error checking recovery status:');
      console.error(err.response?.data?.error || err.message);
      process.exitCode = 1;
    }
  });

// Debugging Commands
program
  .command('node-logs <nodeId>')
  .description('Get logs for a specific node')
  .option('--tail <number>', 'Number of recent log entries to show', '10')
  .action(async (nodeId, options) => {
    try {
      const response = await axios.get(`${API_SERVER_URL}/nodes/${nodeId}/logs`, {
        params: { limit: options.tail }
      });
      
      console.log(`Logs for node ${nodeId}:`);
      response.data.logs.forEach(log => {
        console.log(log);
      });
      
    } catch (err) {
      console.error('Error fetching node logs:');
      console.error(err.response?.data?.error || err.message);
      process.exitCode = 1;
    }
  });

program
  .command('metrics')
  .description('Get system metrics')
  .option('--node <nodeId>', 'Get metrics for specific node')
  .action(async (options) => {
    try {
      const url = options.node 
        ? `${API_SERVER_URL}/nodes/${options.node}/metrics`
        : `${API_SERVER_URL}/metrics`;
      
      const response = await axios.get(url);
      
      if (options.node) {
        console.log(`Node ${options.node} Metrics:`);
        console.log(`CPU Load: ${response.data.cpu.load}/${response.data.cpu.total} cores`);
        console.log(`Memory: ${response.data.memory.used}/${response.data.memory.total}GB used`);
        console.log(`Network: ${response.data.network.in}MB/s in, ${response.data.network.out}MB/s out`);
        console.log(`Temperature: ${response.data.temperature}°C`);
      } else {
        console.log('Cluster Metrics:');
        console.log(`Nodes: ${response.data.nodes.online}/${response.data.nodes.total}`);
        console.log(`CPU Utilization: ${response.data.cpu.utilization}`);
        console.log(`Memory Utilization: ${response.data.memory.utilization}`);
      }
      
    } catch (err) {
      console.error('Error fetching metrics:');
      console.error(err.response?.data?.error || err.message);
      process.exitCode = 1;
    }
  });

// Maintenance Commands
program
  .command('drain-node <nodeId>')
  .description('Prepare node for maintenance by evacuating pods')
  .action(async (nodeId) => {
    try {
      const response = await axios.post(`${API_SERVER_URL}/nodes/${nodeId}/drain`);
      
      console.log(`Draining node ${nodeId}:`);
      if (response.data.evacuatedPods) {
        response.data.evacuatedPods.forEach(pod => {
          console.log(`- Evacuating pod ${pod.id}`);
        });
      }
      console.log('- Marking as maintenance');
      console.log('No new pods will be scheduled');
      
    } catch (err) {
      console.error('Error draining node:');
      console.error(err.response?.data?.error || err.message);
      process.exitCode = 1;
    }
  });

program
  .command('repair-complete <nodeId>')
  .description('Return a node to service after maintenance')
  .action(async (nodeId) => {
    try {
      const response = await axios.post(`${API_SERVER_URL}/nodes/${nodeId}/repair-complete`);
      
      console.log(`Node ${nodeId} returned to service:`);
      console.log(`- Available cores: ${response.data.availableCores}`);
      console.log(`- Accepting new pods`);
      console.log(`Cluster status: ${response.data.clusterStatus.toUpperCase()}`);
      
    } catch (err) {
      console.error('Error completing node repair:');
      console.error(err.response?.data?.error || err.message);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);