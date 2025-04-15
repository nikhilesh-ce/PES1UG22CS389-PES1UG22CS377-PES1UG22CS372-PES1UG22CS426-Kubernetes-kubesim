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
      // Get nodes and pods data
      const nodesResponse = await axios.get(`${API_SERVER_URL}/nodes`);
      const podsResponse = await axios.get(`${API_SERVER_URL}/pods`);

      // Process nodes data (handling both array and object with nodes array)
      const nodes = nodesResponse.data.nodes || nodesResponse.data;
      const healthyNodes = nodes.filter(node => node.status === 'healthy').length;
      const totalNodes = nodes.length;

      // Calculate CPU resources
      const totalCores = nodes.reduce((sum, node) => sum + (node.cpuCores || 0), 0);
      const usedCores = nodes.reduce((sum, node) => sum + ((node.cpuCores || 0) - (node.availableCores || 0)), 0);
      const availableCores = totalCores - usedCores;
      const utilization = `${Math.round((usedCores / totalCores) * 100)}%`;

      // Process pods data (handling nested array format)
      const podEntries = Array.isArray(podsResponse.data) ? podsResponse.data : [];
      const runningPods = podEntries.filter(entry => entry[1]?.status === 'running').length;
      const pendingPods = podEntries.filter(entry => !entry[1]?.status || entry[1]?.status === 'pending').length;

      // Determine overall status (2/3 nodes healthy = degraded, all healthy = healthy, else unhealthy)
      const status = healthyNodes === totalNodes ? 'healthy' :
                    healthyNodes >= Math.floor(totalNodes / 2) ? 'degraded' : 'unhealthy';

      // Format the output
      console.log(`Cluster Status: ${status.toUpperCase()}`);
      console.log(`Nodes: ${healthyNodes}/${totalNodes} operational`);
      console.log(`Resources: ${availableCores}/${totalCores} cores (${utilization}) available`);
      console.log(`Pods: ${runningPods} running, ${pendingPods} pending`);
      console.log(`Last Check: ${new Date().toISOString()}`);

      // Set appropriate exit code
      process.exitCode = status === 'healthy' ? 0 : 
                         status === 'degraded' ? 1 : 2;
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
      console.log(options.verbose ? 'Making API request to simulate failure...' : '');
      const response = await axios.post(
        `${API_SERVER_URL}/nodes/${options.node}/simulate-failure`,
        {}, // empty body
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (options.verbose) {
        console.log('API Response:', JSON.stringify(response.data, null, 2));
      }

      console.log(`Simulating failure on node ${options.node}...`);
      
      if (response.data.recoveryOperations) {
        response.data.recoveryOperations.forEach(op => {
          console.log(`Pod ${op.podId} status: ${op.status}`);
          if (options.verbose && op.toNode) {
            console.log(`  Rescheduled to node ${op.toNode}`);
          }
        });
      }
      
      console.log(`System status: ${response.data.systemStatus || 'UNKNOWN'}`);

    } catch (err) {
      console.error('Error simulating node failure:');
      if (err.response) {
        console.error(`HTTP Status: ${err.response.status}`);
        console.error(`Response: ${JSON.stringify(err.response.data, null, 2)}`);
      } else {
        console.error(err.message);
      }
      process.exitCode = 1;
    }
  });

program
  .command('recovery-status')
  .description('Check status of ongoing recovery operations')
  .action(async () => {
    try {
      const response = await axios.get(`${API_SERVER_URL}/recovery-status`);
      
      console.log('Recovery Operations:');
      response.data.operations.forEach((op, index) => {
        console.log(`${index + 1}. ${op.podId} → node ${op.targetNode} (${op.status.toUpperCase()})`);
      });
      
      if (response.data.estimatedCompletion) {
        console.log(`Estimated completion: ${response.data.estimatedCompletion}s`);
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