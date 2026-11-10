/**
 * TaskFlow - Ejecutor Maestro de Pruebas Automatizadas
 * 
 * Corre secuencialmente las 5 pruebas de evaluación del prototipo:
 * 1. Funcionamiento Básico
 * 2. Concurrencia
 * 3. Distribución de Carga (Round Robin)
 * 4. Escalabilidad (1 vs 2 Trabajadores)
 * 5. Robustez y Tolerancia a Fallos
 * 
 * Recopila los resultados reales y genera automáticamente los reportes
 * en formato JSON y CSV en la carpeta reports/.
 */

const runBasicTest = require('./basic-test');
const runConcurrencyTest = require('./concurrency-test');
const runLoadDistributionTest = require('./load-distribution-test');
const runScalabilityTest = require('./scalability-test');
const runRobustnessTest = require('./robustness-test');
const { saveReport, sleep } = require('./test-helper');
const { performance } = require('perf_hooks');

async function runAllTests() {
  console.log('================================================================');
  console.log('       INICIANDO SUITE COMPLETA DE PRUEBAS DE TASKFLOW          ');
  console.log('================================================================\n');

  const suiteStartTime = performance.now();
  const testResults = [];

  // Prueba 1: Funcionamiento básico
  const r1 = await runBasicTest();
  testResults.push(r1);
  await sleep(1000);

  // Prueba 2: Concurrencia
  const r2 = await runConcurrencyTest();
  testResults.push(r2);
  await sleep(1000);

  // Prueba 3: Distribución de carga
  const r3 = await runLoadDistributionTest();
  testResults.push(r3);
  await sleep(1000);

  // Prueba 4: Escalabilidad
  const r4 = await runScalabilityTest();
  testResults.push(r4);
  await sleep(1000);

  // Prueba 5: Robustez
  const r5 = await runRobustnessTest();
  testResults.push(r5);

  const suiteDuration = parseFloat((performance.now() - suiteStartTime).toFixed(2));

  // Consolidación de métricas globales
  const totalSent = testResults.reduce((acc, t) => acc + (t.tasksSent || 0), 0);
  const totalCompleted = testResults.reduce((acc, t) => acc + (t.tasksCompleted || 0), 0);
  const totalFailed = testResults.reduce((acc, t) => acc + (t.tasksFailed || 0), 0);
  const allPassed = testResults.every(t => t.success);

  const fullReport = {
    suiteName: 'TaskFlow Automated Evaluation Suite',
    executedAt: new Date().toISOString(),
    totalSuiteDurationMs: suiteDuration,
    summary: {
      totalTests: testResults.length,
      testsPassed: testResults.filter(t => t.success).length,
      testsFailed: testResults.filter(t => !t.success).length,
      allPassed,
      totalTasksSent: totalSent,
      totalTasksCompleted: totalCompleted,
      totalTasksFailed: totalFailed
    },
    tests: testResults
  };

  // Guardar reportes en reports/test-results.json y reports/test-results.csv
  saveReport(fullReport);

  // Imprimir cuadro de resumen
  console.log('\n================================================================');
  console.log('               RESUMEN DE EVALUACIÓN Y PRUEBAS                  ');
  console.log('================================================================');
  console.table(testResults.map(t => ({
    'Prueba': t.name,
    'Estado': t.success ? '✔ APROBADA' : '❌ FALLIDA',
    'Enviadas': t.tasksSent,
    'Completadas': t.tasksCompleted,
    'Fallidas': t.tasksFailed,
    'Tiempo Total (ms)': t.totalDurationMs,
    'Promedio CPU (ms)': t.avgProcessingTimeMs
  })));

  console.log(`\nEstado Global: ${allPassed ? '✔ TODAS LAS PRUEBAS SUPERADAS' : '❌ ALGUNAS PRUEBAS FALLARON'}`);
  console.log(`Tiempo total de ejecución de la suite: ${(suiteDuration / 1000).toFixed(2)} s`);
  console.log('================================================================\n');

  process.exit(allPassed ? 0 : 1);
}

if (require.main === module) {
  runAllTests().catch(err => {
    console.error('Error fatal al ejecutar suite de pruebas:', err);
    process.exit(1);
  });
}

module.exports = runAllTests;
