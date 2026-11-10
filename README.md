# TaskFlow – Sistema Distribuido de Procesamiento de Tareas

Prototipo académico funcional de arquitectura distribuida para el procesamiento concurrente de tareas numéricas intensivas mediante **Node.js nativo**, **Worker Threads** y comunicación **HTTP REST**.

---

## 1. Descripción del Proyecto

**TaskFlow** es un sistema distribuido ligero y modular diseñado para demostrar los principios esenciales de los sistemas distribuidos modernos:
- Desacoplamiento de nodos mediante protocolos estándar (HTTP/REST).
- Balanceo de carga equitativo entre múltiples trabajadores independientes.
- Concurrencia real a nivel de hardware utilizando hilos de ejecución del sistema operativo.
- Tolerancia a fallos mediante conmutación por error (*failover*) sin pérdida de tareas.
- Visibilidad y observabilidad en tiempo real a través de métricas y un panel web reactivo.

El prototipo no requiere base de datos ni dependencias externas de terceros (`dependencies: {}`), garantizando máxima portabilidad y arranque instantáneo en entornos Windows (PowerShell / VS Code).

---

## 2. Objetivo del Prototipo

El propósito de este proyecto es netamente didáctico y académico:
1. **Evidenciar la comunicación inter-nodo**: Demostrar cómo un nodo coordinador orquesta peticiones hacia nodos trabajadores remotos usando solicitudes HTTP estándar.
2. **Demostrar concurrencia real en Node.js**: Superar el modelo mono-hilo (*single-threaded*) tradicional mediante el módulo nativo `worker_threads`, ejecutando cálculos pesados de CPU sin bloquear el bucle de eventos (*Event Loop*).
3. **Analizar la distribución y escalabilidad**: Medir experimentalmente el impacto de procesar cargas de trabajo con un solo trabajador frente a un clúster distribuido de múltiples trabajadores.
4. **Verificar la robustez y disponibilidad**: Comprobar la respuesta del sistema ante la desconexión abrupta de nodos y la reasignación automática de trabajo.

---

## 3. Arquitectura Distribuida

La arquitectura se compone de tres nodos independientes distribuidos en diferentes puertos TCP de la máquina local:

```text
                     +---------------------------------------+
                     |     Cliente Web / Pruebas HTTP        |
                     +---------------------------------------+
                                         |
                                         | HTTP REST (Puerto 3000)
                                         v
                     +---------------------------------------+
                     |      NODO 1: SERVIDOR COORDINADOR     |
                     |         (http://localhost:3000)       |
                     |  - Servidor de frontend estático      |
                     |  - API REST unificada                 |
                     |  - Patrón Proxy (Oculta topología)    |
                     |  - Patrón Mediator (Orquestación)     |
                     |  - Algoritmo Round Robin + Failover   |
                     |  - Estado y métricas en memoria RAM   |
                     +---------------------------------------+
                                   /           \
                 HTTP POST /execute             HTTP POST /execute
                 HTTP GET  /health              HTTP GET  /health
                 (Puerto 3001) /                 \ (Puerto 3002)
                              v                   v
        +---------------------------+       +---------------------------+
        |   NODO 2: TRABAJADOR A    |       |   NODO 3: TRABAJADOR B    |
        |  (http://localhost:3001)  |       |  (http://localhost:3002)  |
        | - Servidor HTTP nativo    |       | - Servidor HTTP nativo    |
        | - Cola FIFO en memoria    |       | - Cola FIFO en memoria    |
        | - Pool de 2 hilos nativos:|       | - Pool de 2 hilos nativos:|
        |   * Hilo 1 (WorkerThread) |       |   * Hilo 1 (WorkerThread) |
        |   * Hilo 2 (WorkerThread) |       |   * Hilo 2 (WorkerThread) |
        +---------------------------+       +---------------------------+
```

### Tabla de Puertos y Direcciones de los Nodos

| Nodo | Nombre | Dirección Base | Rol en la Arquitectura |
|---|---|---|---|
| **Nodo 1** | Servidor Coordinador | `http://localhost:3000` | Punto de entrada único, proxy inverso, mediador, balanceador y API REST. |
| **Nodo 2** | Trabajador A | `http://localhost:3001` | Procesamiento concurrente de tareas (Pool de 2 hilos). |
| **Nodo 3** | Trabajador B | `http://localhost:3002` | Procesamiento concurrente de tareas (Pool de 2 hilos). |

---

## 4. Tecnologías Utilizadas

Para mantener el código simple, limpio y sin fricciones de configuración, se utilizaron exclusivamente herramientas nativas:

- **Backend:** Node.js (v18+ / v20+ / v24+).
- **Módulos Nativos de Node.js:**
  - `http`: Creación de servidores y clientes HTTP de alto rendimiento.
  - `worker_threads`: Hilos del sistema operativo para procesamiento concurrente en paralelo.
  - `child_process`: Orquestación multi-proceso desde un solo comando (`scripts/start-all.js`).
  - `fs` y `path`: Lectura de archivos estáticos del frontend y generación de reportes.
  - `perf_hooks`: Medición precisa de tiempos de CPU y de red con resolución de microsegundos.
- **Frontend:** HTML5 semántico, CSS3 moderno (diseño responsivo con variables y flexbox/grid) y JavaScript puro (Vanilla JS con la API estándar `fetch`).
- **Almacenamiento:** En memoria RAM (estructuras `Map` y objetos nativos, sin bases de datos externas).
- **Diagramas de Arquitectura:** PlantUML (`.puml`).

---

## 5. Componentes y Responsabilidades

### Coordinador (`coordinator/server.js`)
- Expone la API REST en el puerto `3000`.
- Sirve los recursos de la interfaz web (`index.html`, `styles.css`, `app.js`).
- Mantiene el registro de los trabajadores y consulta periódicamente su disponibilidad (`/health`).
- Aplica el algoritmo **Round Robin** para repartir las tareas entrantes entre los trabajadores activos.
- Implementa **Failover**: Si un trabajador falla o expira el tiempo de espera, redirige inmediatamente la tarea al nodo alternativo.
- Almacena el historial y calcula las métricas globales (tareas recibidas, completadas, fallidas, tiempo promedio y distribución por nodo).

### Nodos Trabajadores (`workers/worker-server.js`)
- Servidores HTTP ligeros ejecutándose en los puertos `3001` y `3002`.
- Instancian y supervisan un pool fijo de **2 Worker Threads**.
- Mantienen una cola FIFO en memoria (`taskQueue`) para recibir solicitudes adicionales cuando ambos hilos se encuentran ocupados.
- Reinician automáticamente cualquier hilo que termine con código de error, asegurando alta disponibilidad.

### Hilo de Cómputo (`workers/task-thread.js`)
- Código ejecutado por cada hilo de `worker_threads`.
- Ejecuta el cálculo intensivo de CPU: determinación de números primos hasta un límite especificado por el usuario mediante un algoritmo de división optimizado ($6k \pm 1$).
- Devuelve al hilo principal la cantidad exacta de primos hallados, una muestra de los primeros números generados y el tiempo exacto de CPU consumido.

---

## 6. Patrones de Diseño Implementados

Se incorporaron dos patrones de diseño estructurales y de comportamiento, documentados explícitamente en el código fuente:

### 1. Patrón Proxy
- **Ubicación en código:** `coordinator/server.js` (Líneas 1-30, 214-250).
- **Justificación y Utilidad:**
  El servidor coordinador actúa como un **proxy inverso** (*reverse proxy*) entre los clientes externos (navegador web o scripts de prueba) y la red interna de trabajadores. 
  - El usuario interactúa únicamente con `http://localhost:3000/api/tasks`.
  - La topología interna, direcciones IP, puertos (`3001`, `3002`) y el número de nodos de procesamiento permanecen totalmente ocultos para el cliente.
  - El proxy valida los datos de entrada, previene cargas maliciosas y abstrae la complejidad de la red distribuida.

### 2. Patrón Mediator (Mediador)
- **Ubicación en código:** `coordinator/server.js` (Líneas 25-145, función `dispatchTaskWithFailover`).
- **Justificación y Utilidad:**
  El coordinador actúa como el **mediador central** que encapsula y arbitra cómo interactúan todos los componentes del sistema.
  - Los nodos trabajadores (Trabajador A y Trabajador B) están completamente desacoplados entre sí; no se conocen ni requieren comunicación directa.
  - El mediador centraliza la lógica de balanceo (Round Robin), comprueba la salud de los nodos antes de delegar trabajo, gestiona la conmutación por error ante caídas y consolida el estado global y las métricas.

---

## 7. Funcionamiento de los Hilos de Ejecución (`worker_threads`)

Node.js utiliza por defecto un modelo mono-hilo basado en un bucle de eventos (*Event Loop*). Cuando una operación requiere cómputo intensivo de CPU (como calcular cientos de miles de números primos), el Event Loop se bloquea y el servidor deja de responder a nuevas peticiones HTTP.

Para resolver esto sin necesidad de procesos pesados:
1. **Pool de Hilos Fijo:** Cada trabajador crea exactamente **2 instancias de `Worker`** al iniciar.
2. **Paso de Mensajes Asíncrono (IPC):** El servidor del trabajador se comunica con el hilo mediante `worker.postMessage()` y escucha el resultado con `worker.on('message')`.
3. **Paralelismo Real:** Los 2 hilos del Trabajador A sumados a los 2 hilos del Trabajador B permiten ejecutar **4 tareas intensivas simultáneas** en paralelo sobre los núcleos físicos de la CPU.
4. **Cola de Espera (Queue):** Si una tercera tarea llega a un trabajador cuyos 2 hilos están procesando, la tarea se añade a un arreglo FIFO en memoria y se dispara inmediatamente apenas uno de los hilos finaliza su cálculo anterior.

---

## 8. Estructura de Carpetas

```text
TaskFlow/
│
├── coordinator/
│   └── server.js               # Nodo 1: Servidor principal, Proxy, Mediator y API REST
│
├── workers/
│   ├── worker-server.js        # Nodos 2 y 3: Servidor HTTP del trabajador y pool de hilos
│   └── task-thread.js          # Hilo worker_threads: cálculo de números primos
│
├── frontend/
│   ├── index.html              # Interfaz web responsiva con monitor de nodos y métricas
│   ├── styles.css              # Estilos visuales modernos (dark mode, tarjetas y badges)
│   └── app.js                  # Lógica de cliente, envío en ráfaga y polling periódico (1.5s)
│
├── diagrams/
│   ├── componentes.puml        # Diagrama de componentes PlantUML
│   ├── secuencia.puml          # Diagrama de secuencia PlantUML
│   └── despliegue.puml         # Diagrama de despliegue físico/lógico PlantUML
│
├── tests/
│   ├── test-helper.js          # Utilidades comunes y arnés de pruebas automatizadas
│   ├── basic-test.js           # Prueba 1: Funcionamiento básico y validación de primos
│   ├── concurrency-test.js     # Prueba 2: Concurrencia con 4 hilos en paralelo
│   ├── load-distribution-test.js # Prueba 3: Balanceo equitativo Round Robin
│   ├── scalability-test.js     # Prueba 4: Comparación 1 trabajador vs 2 trabajadores
│   ├── robustness-test.js      # Prueba 5: Caída de nodo y conmutación por error (failover)
│   └── run-all-tests.js        # Ejecutor maestro de toda la suite con reporte consolidado
│
├── reports/
│   ├── test-results.json       # Resultados reales de las pruebas en JSON
│   └── test-results.csv        # Resultados reales de las pruebas en CSV
│
├── scripts/
│   └── start-all.js            # Orquestador de arranque unificado para Windows
│
├── package.json                # Configuración de scripts npm y metadatos (0 dependencias)
└── README.md                   # Documentación técnica completa en español
```

---

## 9. Requisitos de Instalación

- **Sistema Operativo:** Windows 10 / 11 (o Linux / macOS).
- **Entorno de Ejecución:** Node.js versión **18.0.0 o superior** (verificado en Node.js v24.14.0).
- **Dependencias de terceros:** **Ninguna** (`dependencies: {}`). No es necesario ejecutar instalaciones pesadas de npm.

Verificación de requisitos en terminal:
```powershell
node -v
npm -v
```

---

## 10. Instrucciones para Ejecutar el Proyecto en Windows

### Inicio Unificado (Recomendado)
Para iniciar los 3 nodos (Coordinador, Trabajador A y Trabajador B) con un único comando:

```powershell
npm start
```

El script `scripts/start-all.js` levantará concurrentemente los procesos y mostrará en la consola una salida etiquetada por color:
- `[COORDINATOR]` (Verde): Puerto `3000`
- `[WORKER-A]` (Magenta): Puerto `3001`
- `[WORKER-B]` (Cian): Puerto `3002`

Para detener todos los nodos simultáneamente, basta con presionar `Ctrl + C` en la misma terminal.

### Abrir la Aplicación
Una vez iniciado el sistema, abre tu navegador web favorito e ingresa a:

```text
http://localhost:3000
```

### Inicio de Nodos de Forma Individual (Opcional)
Si deseas iniciar cada nodo en una terminal independiente para observar su comportamiento por separado:

```powershell
# Terminal 1: Iniciar Trabajador A
npm run start:worker-a

# Terminal 2: Iniciar Trabajador B
npm run start:worker-b

# Terminal 3: Iniciar Servidor Coordinador
npm run start:coordinator
```

---

## 11. Instrucciones para Ejecutar las Pruebas

El proyecto cuenta con un arnés de pruebas automatizado que ejecuta mediciones reales de tiempo, concurrencia, balanceo y tolerancia a fallos.

### Ejecutar la Suite Completa
Para ejecutar secuencialmente las 5 pruebas de evaluación y generar los reportes en `reports/`:

```powershell
npm test
```

### Ejecutar Pruebas Individuales
```powershell
npm run test:basic         # Prueba 1: Funcionamiento básico
npm run test:concurrency   # Prueba 2: Concurrencia con 4 hilos
npm run test:distribution  # Prueba 3: Distribución Round Robin
npm run test:scalability   # Prueba 4: Escalabilidad (1 vs 2 trabajadores)
npm run test:robustness    # Prueba 5: Robustez y tolerancia a fallos
```

---

## 12. Resultados Reales de las Pruebas

Los siguientes datos corresponden a la ejecución real de la suite de pruebas automatizadas sobre el entorno local:

### Resumen Consolidado de la Evaluación

| # | Prueba | Estado | Tareas Enviadas | Completadas | Fallidas | Tiempo Total (ms) | Promedio CPU (ms) |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Funcionamiento Básico** | ✔ APROBADA | 1 | 1 | 0 | 200.10 | 82.56 |
| **2** | **Concurrencia (4 hilos)** | ✔ APROBADA | 4 | 4 | 0 | 293.47 | 185.09 |
| **3** | **Distribución de Carga** | ✔ APROBADA | 8 | 8 | 0 | 435.57 | 38.67 |
| **4** | **Escalabilidad** | ✔ APROBADA | 12 | 12 | 0 | 1523.68 | 266.93 |
| **5** | **Robustez (Failover)** | ✔ APROBADA | 2 | 2 | 0 | 2085.46 | 53.72 |
| **Total** | **Suite Completa** | **✔ 100% OK** | **27** | **27** | **0** | **19.28 s** | - |

### Análisis Detallado de Cada Prueba

1. **Prueba 1 – Funcionamiento Básico:**
   - Se envió una tarea con límite de `500,000`.
   - Se verificó que el cálculo de números primos devolviera exactamente **41,538** números primos (constante matemática exacta para este rango).
   - La tarea fue procesada por el Trabajador A utilizando su Hilo #1 en 82.56 ms de CPU.
2. **Prueba 2 – Concurrencia:**
   - Se disparó una ráfaga simultánea de 4 tareas de límite `600,000` con `Promise.all`.
   - Las 4 tareas se ejecutaron en paralelo ocupando los 2 hilos del Trabajador A y los 2 hilos del Trabajador B.
   - La suma acumulada de tiempo de CPU demandado fue de **740.34 ms**, mientras que el tiempo total de reloj (*wall-clock time*) fue de solo **293.47 ms**, confirmando paralelismo efectivo de hardware.
3. **Prueba 3 – Distribución de Carga (Round Robin):**
   - Se enviaron 8 tareas sucesivas.
   - La asignación alternó estrictamente: Tarea 1 a Trabajador A, Tarea 2 a Trabajador B, Tarea 3 a Trabajador A, etc.
   - Resultado: **4 tareas al Trabajador A (50%)** y **4 tareas al Trabajador B (50%)**.
4. **Prueba 4 – Escalabilidad:**
   - Se procesó un lote idéntico de 6 tareas pesadas (límite `700,000`) bajo dos configuraciones:
     - Con 1 trabajador (2 hilos): **780.21 ms**.
     - Con 2 trabajadores (4 hilos): **743.47 ms**.
     - Factor de aceleración (*speedup*) real obtenido: **1.05x** (5% de reducción del tiempo total bajo recursos locales compartidos).
5. **Prueba 5 – Robustez y Tolerancia a Fallos:**
   - Se detuvo abruptamente el proceso del Trabajador B (`kill SIGKILL`).
   - Se enviaron 2 tareas al servidor coordinador.
   - El coordinador detectó la desconexión del Trabajador B y activó el mecanismo de conmutación por error (*failover*), canalizando el 100% del tráfico al Trabajador A disponible. Cero tareas perdidas y estado HTTP `201 Created` exitoso para el cliente.

Los archivos completos generados se encuentran en:
- `reports/test-results.json`
- `reports/test-results.csv`

---

## 13. Limitaciones del Prototipo

Al tratarse de una solución diseñada para fines académicos:
- **Almacenamiento volátil:** Las tareas y las métricas se conservan en la memoria RAM del servidor coordinador. Al reiniciar el proceso, el historial se restablece.
- **Topología estática:** El coordinador tiene preconfigurados los dos trabajadores en `localhost:3001` y `localhost:3002`. La incorporación dinámica de nuevos nodos requeriría reiniciar o extender el registro.
- **Entorno mono-máquina:** Si bien los 3 nodos operan como procesos y servidores HTTP desacoplados, se ejecutan en la misma máquina física para facilitar las pruebas en Windows sin requerir configuración de redes complejas.

---

## 14. Posibles Mejoras Futuras

1. **Descubrimiento dinámico de servicios (Service Discovery):** Permitir que nuevos trabajadores se registren automáticamente en el coordinador mediante un endpoint `POST /api/workers/register` y pulsos de latido (*heartbeats*).
2. **Estrategias avanzadas de balanceo de carga:** Incorporar algoritmos de *Least Connections* (menor cantidad de tareas en cola/hilos ocupados) o balanceo ponderado según la capacidad del nodo.
3. **Persistencia liviana:** Incorporar un almacenamiento en disco simple (archivo JSON o SQLite nativo) para conservar el historial de tareas entre reinicios.
4. **WebSockets o Server-Sent Events (SSE):** Reemplazar el sondeo periódico (*polling* HTTP) del frontend por una conexión persistente para streaming de eventos en tiempo real.

---

## 15. Explicación de los Diagramas UML

Los diagramas fueron modelados en PlantUML dentro de la carpeta `diagrams/` y representan fielmente la arquitectura implementada:

### 1. Diagrama de Componentes (`diagrams/componentes.puml`)
Ilustra los módulos que componen el sistema y sus canales de comunicación:
- El componente **Interfaz Web** se comunica con el **Servidor Estático** y la **API REST** mediante HTTP.
- En el Coordinador se evidencian los componentes internos: **Controlador REST**, el **Coordinador** (con los patrones Proxy y Mediator), el **Balanceador Round Robin** y el **Gestor de Estado y Métricas**.
- Los nodos **Trabajador A** y **Trabajador B** exponen su **Servidor HTTP**, una **Cola FIFO** y su **Pool de Concurrencia** conformado por 2 Worker Threads (`task-thread.js`).

### 2. Diagrama de Secuencia (`diagrams/secuencia.puml`)
Modela la interacción temporal paso a paso cuando un usuario solicita el procesamiento de una tarea:
1. El usuario ingresa el límite y envía el formulario desde la interfaz web (`app.js`).
2. El coordinador recibe la petición en `POST /api/tasks`, registra la tarea en estado `pendiente` y evalúa el siguiente trabajador por Round Robin.
3. El coordinador envía un mensaje `POST /execute` vía HTTP al trabajador seleccionado.
4. El servidor del trabajador asigna la tarea a un hilo libre del pool mediante `worker.postMessage()`.
5. El hilo ejecuta el cálculo de primos en segundo plano midiendo el tiempo de CPU y devuelve el resultado vía `parentPort.postMessage()`.
6. El trabajador responde HTTP 200 OK con el resultado al coordinador.
7. El coordinador actualiza el estado a `completada`, recalcula métricas y retorna la respuesta a la interfaz web, la cual refresca la tabla y paneles visuales.

### 3. Diagrama de Despliegue (`diagrams/despliegue.puml`)
Muestra la distribución física y lógica de los nodos:
- **Dispositivo Cliente:** Ejecuta el navegador web con el artefacto del cliente (`index.html`, `styles.css`, `app.js`).
- **Servidor Local (Windows):** Alberga tres entornos de ejecución Node.js independientes:
  - **Nodo 1 (Puerto 3000):** Ejecuta `coordinator/server.js` y almacena el estado en memoria RAM.
  - **Nodo 2 (Puerto 3001):** Ejecuta `workers/worker-server.js` gestionando 2 hilos del sistema operativo (`task-thread.js`).
  - **Nodo 3 (Puerto 3002):** Ejecuta la segunda instancia de `workers/worker-server.js` con sus 2 hilos de ejecución.
- Define claramente los protocolos de transporte: HTTP/REST sobre TCP/IP entre nodos y comunicación IPC nativa de hilos dentro de cada trabajador.

---

## Especificación de la API REST

| Método | Endpoint | Descripción | Respuesta Exitosa (200/201) |
|---|---|---|---|
| `GET` | `/api/health` | Consulta la disponibilidad del servidor coordinador. | `{ status: "ok", coordinator: "online", port: 3000, uptimeSeconds: 45.2 }` |
| `GET` | `/api/workers` | Consulta el estado y los hilos activos de cada trabajador. | `[ { id: "worker-a", name: "Trabajador A", status: "online", activeThreads: 0, queueLength: 0 }, ... ]` |
| `POST` | `/api/tasks` | Crea y distribuye una nueva tarea de cálculo. Body: `{"limit": 500000}`. | `{ id: "task-1", status: "completada", workerAssigned: "Trabajador A", threadId: 1, primesCount: 41538, executionTimeMs: 82.5 }` |
| `GET` | `/api/tasks` | Obtiene el listado completo de tareas registradas. | `[ { id: "task-1", limit: 500000, status: "completada", ... } ]` |
| `GET` | `/api/tasks/:id` | Consulta los detalles de una tarea específica por su ID. | `{ id: "task-1", limit: 500000, status: "completada", ... }` |
| `GET` | `/api/metrics` | Consulta las métricas globales consolidadas del clúster. | `{ totalTasksReceived: 27, completedTasks: 27, failedTasks: 0, averageProcessingTimeMs: 88.5, tasksPerWorker: { ... } }` |
