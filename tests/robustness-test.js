/**
 * TaskFlow - Prueba 5: Robustez y Tolerancia a Fallos
 * 
 * Objetivo: Detener intencionalmente uno de los nodos trabajadores (Trabajador B)
 * y comprobar que:
 * 1. El coordinador detecta la indisponibilidad del nodo.
 * 2. Si una tarea es asignada a un nodo caído, se activa el mecanismo de Failover
 *    y se reenvía automáticamente al Trabajador A disponible.
 * 3. La tarea culmina exitosamente sin pérdida de datos ni bloqueo del sistema.
 */

const { spawnNode, sleep, requestHttp } = require('./test-helper');
const { performance } = require('perf_hooks');
const path = require('path');

const WORKER_SCRIPT = path.join(__dirname, '..', 'workers', 'worker-server.js');
const COORDINATOR_SCRIPT = path.join(__dirname, '..', 'coordinator', 'server.js');

async function waitForCoordinator(url = 'http://localhost:3000', maxTries = 15) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const h = await requestHttp(`${url}/api/health`, 'GET', null, 800);
      if (h && h.coordinator === 'online') return true;
    } catch (e) {}
    await sleep(400);
  }
  return false;
}

async function runRobustnessTest() {
  console.log('\n======================================================');
  console.log('  EJECUTANDO PRUEBA 5: ROBUSTEZ Y TOLERANCIA A FALLOS');
  console.log('======================================================');

  let pCoord = null;
  let pWorkA = null;
  let pWorkB = null;
  const startTime = performance.now();

  try {
    // 1. Iniciar los 3 nodos normalmente
    console.log('[PRUEBA 5] Iniciando clúster completo (Trabajador A, B y Coordinador)...');
    pWorkA = spawnNode(WORKER_SCRIPT, ['3001', 'Trabajador A']);
    pWorkB = spawnNode(WORKER_SCRIPT, ['3002', 'Trabajador B']);
    await sleep(600);
    pCoord = spawnNode(COORDINATOR_SCRIPT, ['3000']);
    await waitForCoordinator();

    // 2. Verificar que ambos trabajadores respondan en /api/workers
    const initialWorkers = await requestHttp('http://localhost:3000/api/workers', 'GET');
    console.log('[PRUEBA 5] Estado inicial de los nodos:');
    initialWorkers.forEach(w => console.log(`  - ${w.name}: ${w.status}`));

    // 3. Simular caída abrupta del Trabajador B
    console.log('\n[PRUEBA 5] 💥 DETENIENDO ABRUPTAMENTE EL TRABAJADOR B (:3002)...');
    pWorkB.kill('SIGKILL');
    pWorkB = null;
    await sleep(800);

    // 4. Enviar 2 tareas mientras el Trabajador B está caído
    console.log('[PRUEBA 5] Enviando tarea 1 con Trabajador B caído (debe redirigir/failover a Trabajador A)...');
    const task1 = await requestHttp('http://localhost:3000/api/tasks', 'POST', { limit: 400000 });
    console.log(`[PRUEBA 5] Tarea 1 procesada:`, {
      id: task1.id,
      estado: task1.status,
      nodoAsignado: task1.workerAssigned,
      hilo: task1.threadId,
      primos: task1.primesCount
    });

    console.log('\n[PRUEBA 5] Enviando tarea 2 adicional para confirmar enrutamiento continuo...');
    const task2 = await requestHttp('http://localhost:3000/api/tasks', 'POST', { limit: 400000 });
    console.log(`[PRUEBA 5] Tarea 2 procesada:`, {
      id: task2.id,
      estado: task2.status,
      nodoAsignado: task2.workerAssigned,
      hilo: task2.threadId,
      primos: task2.primesCount
    });

    // 5. Validar que ambas tareas fueron completadas por Trabajador A (o con failover)
    if (task1.status !== 'completada' || task2.status !== 'completada') {
      throw new Error(`Las tareas no se completaron tras la caída del Trabajador B.`);
    }

    if (!task1.workerAssigned.includes('Trabajador A') || !task2.workerAssigned.includes('Trabajador A')) {
      throw new Error(`Las tareas debieron ser atendidas por el Trabajador A disponible.`);
    }

    const totalDuration = parseFloat((performance.now() - startTime).toFixed(2));
    const avgCpu = parseFloat(((task1.executionTimeMs + task2.executionTimeMs) / 2).toFixed(2));

    const result = {
      name: 'Prueba 5 - Robustez y Tolerancia a Fallos',
      success: true,
      tasksSent: 2,
      tasksCompleted: 2,
      tasksFailed: 0,
      totalDurationMs: totalDuration,
      avgProcessingTimeMs: avgCpu,
      details: `Trabajador B detenido abruptamente. El sistema detectó la falla, redirigió 100% de las tareas a Trabajador A sin pérdida de datos.`
    };

    console.log('\n✔ PRUEBA 5 SUPERADA EXITOSAMENTE');
    return result;
  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBA 5:', err.message);
    return {
      name: 'Prueba 5 - Robustez y Tolerancia a Fallos',
      success: false,
      tasksSent: 2,
      tasksCompleted: 0,
      tasksFailed: 2,
      totalDurationMs: parseFloat((performance.now() - startTime).toFixed(2)),
      avgProcessingTimeMs: 0,
      details: `Fallo: ${err.message}`
    };
  } finally {
    if (pCoord) pCoord.kill('SIGINT');
    if (pWorkA) pWorkA.kill('SIGINT');
    if (pWorkB) pWorkB.kill('SIGINT');
    await sleep(600);
  }
}

if (require.main === module) {
  runRobustnessTest().then(res => {
    process.exit(res.success ? 0 : 1);
  });
}

module.exports = runRobustnessTest;
