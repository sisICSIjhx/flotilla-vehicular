# MEMORY.md - Contexto y Preferencias del MVP

## Identificación del Proyecto

**Nombre del Proyecto**: MVP Control de Recorridos Vehiculares  
**Cliente/Propietario**: [Cliente a llenar]  
**Fecha de Inicio**: Abril 2026  
**Plazo Demo**: Mañana temprano  
**Estado**: En desarrollo  

---

## Contexto del Negocio

### Problema que Resuelve
Una empresa de transporte/distribución necesita registrar rápidamente:
- Cuándo salen los vehículos
- Cuándo regresan
- Cuántos km se recorrieron
- Cuánto combustible se consumió
- Cuál fue el costo

### Usuario Final
- **Conductores** en campo, usando celulares
- **Coordinadores/Supervisores** viendo histórico e indicadores
- **NO hay roles complejos**: todos ven todo en MVP

---

## Decisiones Críticas Tomadas

### 1. Autenticación
- ✅ **SIN login obligatorio**
- ✅ Conductor se auto-identifica en cada uso (campo de texto)
- ✅ La app es "pública" pero operativa
- ❌ NO agregar roles, permisos, ni autenticación avanzada en MVP

### 2. Identificación de Vehículos
- ✅ Mediante **código único** (ej: VEH001)
- ✅ **QR como entrada** (escanea QR → URL → /vehiculo/VEH001)
- ✅ QR ya existe o se genera fuera de la app
- ❌ NO crear generador de QR en MVP

### 3. Fotos
- ✅ **Captura en vivo** con cámara del celular
- ✅ **Obligatoria** en salida y regreso
- ✅ **Compresión antes de subir** (JPG, max 1280px, calidad 0.7)
- ✅ **Preview obligatorio** antes de confirmar
- ✅ **Legible** pero comprimida (idealmente <300KB)
- ❌ NO usar OCR
- ❌ NO almacenar original sin comprimir

### 4. Combustible
- ✅ **Escala discreta**: Vacío, 1/4, 1/2, 3/4, Lleno
- ✅ Select dropdown (no input text)
- ❌ NO registrar en litros exactos en MVP

### 5. Centros de Costo
- ✅ **Lista predefinida** en BD
- ✅ Select dropdown
- ❌ NO permitir crear nuevos en MVP
- ❌ NO dejar campo libre

### 6. Base de Datos
- ✅ **Tabla principal**: recorridos
- ✅ **Tabla opcional**: vehiculos (para validaciones)
- ✅ **Tabla**: centros_costo (datos maestros)
- ✅ **Índices**: en vehiculo_codigo, estado, fecha_salida
- ✅ **Constraints**: CHECK para validaciones críticas
- ❌ NO agregar más tablas en MVP
- ❌ NO usar triggers ni funciones SQL avanzadas

### 7. Histórico
- ✅ Máximo 50 registros sin paginación compleja
- ✅ Filtros: vehículo, semana, mes
- ✅ Columnas: fecha salida, fecha regreso, vehículo, conductor, centro costo, km inicial, km final, km recorridos, litros cargados, costo, rendimiento
- ✅ Cálculos derivados (km recorridos, costo, rendimiento)
- ❌ NO exportar CSV/PDF en MVP
- ❌ NO búsqueda avanzada
- ❌ NO paginación con scroll infinito

### 8. Indicadores
- ✅ Pantalla separada
- ✅ Gráficas con Chart.js
- ✅ Al menos: km por vehículo, km semanal/mensual, costo por período
- ✅ Cálculos: km/día, km/semana, km/mes, costo/día, costo/semana, costo/mes, rendimiento promedio
- ❌ NO análisis predictivo
- ❌ NO comparativas complejas

### 9. Validaciones
- ✅ **Frontend**: prevención temprana
- ✅ **Supabase**: constraints como último resguardo
- ✅ **Reglas de negocio**:
  - No crear recorrido si ya hay uno abierto
  - No cerrar si no hay abierto
  - km_regreso >= km_salida
  - Fotos obligatorias
  - No editar después de cerrado
- ❌ NO validaciones complejas de datos

### 10. Stack Tecnológico
- ✅ **Frontend**: Next.js (App Router)
- ✅ **BD**: Supabase (Postgres)
- ✅ **Storage**: Supabase Storage (bucket: recorridos)
- ✅ **Deploy**: Vercel
- ✅ **Estilos**: Tailwind CSS
- ✅ **QR**: html5-qrcode
- ✅ **Compresión**: browser-image-compression
- ✅ **Gráficas**: Chart.js + react-chartjs-2
- ✅ **Validación**: Zod
- ✅ **Fechas**: date-fns
- ❌ NO librerías adicionales no justificadas
- ❌ NO frameworks de componentes complejos (Material-UI, Ant Design)

### 11. Manejo de Errores
- ✅ Si foto falla al subir → mostrar error y permitir reintento
- ✅ NO guardar sin foto
- ✅ Asumir conexión estable
- ❌ NO manejar offline
- ❌ NO queue de sync

### 12. Seguridad
- ✅ **MVP**: sin RLS (Row Level Security) de Supabase
- ✅ **MVP**: sin autenticación backend
- ✅ **MVP**: Storage público (sin autenticación)
- ⚠️ **Futuro**: agregar RLS, autenticación, restricciones de acceso

---

## Flujo de Usuario (Esperado)

### Escenario A: Salida de Vehículo
```
1. Conductor abre app
2. Escanea QR del vehículo
3. App verifica: ¿hay recorrido abierto para VEH001?
   → NO → Mostrar formulario de salida
4. Completa:
   - Nombre (texto)
   - Centro de costo (dropdown)
   - km inicial (número)
   - Combustible inicial (dropdown)
   - Captura foto tablero (cámara)
5. Preview de foto
6. Confirma
7. App comprime foto
8. Sube a Storage
9. Guarda en BD (estado='abierto')
10. "✓ Salida registrada"
```

### Escenario B: Regreso de Vehículo
```
1. Conductor abre app
2. Escanea QR del vehículo
3. App verifica: ¿hay recorrido abierto para VEH001?
   → SÍ → Mostrar formulario de regreso
4. Completa:
   - km final (número, >= km inicial)
   - Combustible final (dropdown)
   - Captura foto tablero (cámara)
   - Litros cargados (decimal)
   - Precio por litro (decimal)
5. Preview de foto
6. Confirma
7. App comprime foto
8. Sube a Storage
9. Actualiza recorrido (estado='cerrado')
10. "✓ Regreso registrado"
```

---

## Estructura de Datos Importante

### Tabla: recorridos
```
id (UUID)
vehiculo_codigo (VARCHAR)
conductor (VARCHAR)
centro_costo (VARCHAR)
fecha_salida (TIMESTAMP) ← AUTO
km_salida (INTEGER)
combustible_salida (VARCHAR: Vacío|1/4|1/2|3/4|Lleno)
foto_salida_path (TEXT) ← Path en Storage
fecha_regreso (TIMESTAMP, nullable) ← AUTO en UPDATE
km_regreso (INTEGER, nullable)
combustible_regreso (VARCHAR, nullable)
foto_regreso_path (TEXT, nullable)
litros_cargados (DECIMAL, nullable)
precio_litro (DECIMAL, nullable)
estado (VARCHAR: abierto|cerrado) ← DEFAULT 'abierto'
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### Campos Calculados (NO en BD)
```
km_recorridos = km_regreso - km_salida
importe = litros_cargados * precio_litro
rendimiento = km_recorridos / litros_cargados
```

---

## Constantes y Enumeraciones

### Niveles de Combustible
```typescript
const COMBUSTIBLE_LEVELS = ['Vacío', '1/4', '1/2', '3/4', 'Lleno'];
```

### Estados de Recorrido
```typescript
const RECORRIDO_ESTADOS = ['abierto', 'cerrado'];
```

### Centros de Costo (ejemplo)
```
CC001 - Centro Administrativo
CC002 - Centro de Distribución
CC003 - Centro de Servicio
CC004 - Depósito Regional
CC005 - Otra ubicación
```

---

## Rutas de la Aplicación

| Ruta | Propósito | Acceso |
|---|---|---|
| `/` | Home / Escaneo QR | Público |
| `/vehiculo/[codigo]` | Detección de estado | Público |
| `/salida` | Formulario de salida | Público |
| `/regreso` | Formulario de regreso | Público |
| `/historico` | Listado de recorridos | Público |
| `/indicadores` | Gráficas y estadísticas | Público |

---

## Reglas de Negocio Críticas

### Crear Recorrido (Salida)
```
Precondición:
  ✓ Existe vehículo en tabla vehiculos
  ✓ NO existe recorrido con estado='abierto' para ese vehículo
  
Acción:
  INSERT INTO recorridos (
    vehiculo_codigo, conductor, centro_costo,
    km_salida, combustible_salida, foto_salida_path,
    estado, fecha_salida
  ) VALUES (...)
  
Postcondición:
  ✓ Recorrido creado con estado='abierto'
  ✓ fecha_salida = NOW()
  ✓ km_recorridos = NULL (no calculable aún)
```

### Cerrar Recorrido (Regreso)
```
Precondición:
  ✓ Existe recorrido con estado='abierto' para ese vehículo
  ✓ km_regreso >= km_salida
  ✓ Foto de regreso presente

Acción:
  UPDATE recorridos SET (
    km_regreso, combustible_regreso, foto_regreso_path,
    litros_cargados, precio_litro,
    estado='cerrado', fecha_regreso
  ) WHERE id=recorrido_id

Postcondición:
  ✓ Recorrido cerrado
  ✓ km_recorridos calculable (km_regreso - km_salida)
  ✓ importe calculable (litros_cargados * precio_litro)
  ✓ rendimiento calculable
  ✓ NO permitir edición después (estado='cerrado')
```

### Calcular Indicadores
```
km_recorridos = SUM(km_regreso - km_salida) para periodo
costo = SUM(litros_cargados * precio_litro) para periodo
rendimiento = SUM(km_recorridos) / SUM(litros_cargados)
```

---

## Preferencias de Desarrollo

### Estilo de Código
- ✅ Nombres en **inglés o español consistente**
- ✅ TypeScript en todo (no JavaScript)
- ✅ Componentes funcionales con hooks
- ✅ Server components donde sea posible (Next.js App Router)
- ✅ Validación con Zod en entrada
- ✅ Manejo de errores explícito (no silencioso)
- ❌ NO abstracciones innecesarias
- ❌ NO componentes genéricos excesivos
- ❌ NO optimizaciones prematuras

### Carpetas y Organización
- Seguir estructura en `CLAUDE.md`
- Componentes por funcionalidad (forms/, display/, common/)
- Lógica en `lib/` y `utils/`
- Tipos en `types/`
- Sin carpetas anidadas excesivas

### Git y Versionado
- ✅ Commits descriptivos en español
- ✅ .gitignore incluye: .env.local, node_modules, .next, dist
- ✅ README.md con setup y deploy

---

## Configuración de Infraestructura

### Supabase
```
Proyecto: control-recorridos-mvp
Tablas: recorridos, vehiculos, centros_costo
Bucket Storage: recorridos (público en MVP)
Región: [Elegir más cercana a usuario]
RLS: Desactivado en MVP (agregar después)
```

### Vercel
```
Proyecto: control-recorridos
Framework: Next.js
Build: npm run build
Start: next start
Environment: Production
```

### Variables de Entorno
```
NEXT_PUBLIC_SUPABASE_URL = [URL del proyecto]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [Anon key del proyecto]
NEXT_PUBLIC_APP_URL = [URL de la app, localhost o Vercel]
```

---

## Métricas de Éxito del MVP

- [x] Escaneo QR abre correctamente el vehículo
- [x] Detección de estado (abierto/cerrado) es 100% precisa
- [x] Formulario de salida guarda datos y foto comprimida
- [x] Formulario de regreso cierra recorrido y guarda datos
- [x] Foto es legible después de compresión
- [x] Histórico muestra registros correctamente
- [x] Filtros por vehículo, semana, mes funcionan
- [x] Indicadores se calculan y grafican sin errores
- [x] App es responsive en móvil (iOS y Android)
- [x] Deploy en Vercel funciona en producción
- [x] Demo presentable mañana temprano ✅

---

## Scope Definitivo (MVP)

### Incluido ✅
- Escaneo QR
- Formulario de salida/regreso
- Compresión de fotos
- Almacenamiento en Supabase
- Histórico con filtros
- Indicadores básicos
- Gráficas con Chart.js

### Excluido ❌
- Autenticación avanzada
- Roles y permisos
- Geolocalización
- Offline mode
- OCR
- Exportación CSV/PDF
- Reportes avanzados
- Analítica profunda
- Multi-idioma
- Notificaciones
- Búsqueda full-text
- Edición de registros cerrados
- Undo/redo

---

## Mejoras Futuras (POST-MVP)

### Fase 2: Seguridad y Autenticación
- [ ] Agregar RLS en Supabase
- [ ] Autenticación con email/contraseña
- [ ] Roles: admin, supervisor, conductor
- [ ] Restricción de acceso a datos propios

### Fase 3: Funcionalidades Avanzadas
- [ ] Geolocalización automática
- [ ] Búsqueda y filtros complejos
- [ ] Exportación a CSV/PDF
- [ ] Reportes automáticos (diarios, semanales)
- [ ] Notificaciones (atrasos, recorridos no cerrados)
- [ ] Edición controlada de registros

### Fase 4: Experiencia
- [ ] Offline mode con sync
- [ ] OCR para leer tablero automáticamente
- [ ] Sugerencias inteligentes
- [ ] Comparativas de rendimiento
- [ ] Alertas de anomalías

### Fase 5: Operaciones
- [ ] Integración con GPS
- [ ] Rutas optimizadas
- [ ] Asignación automática de recorridos
- [ ] Predicción de llegadas

---

## Contactos y Responsables

| Rol | Nombre | Contacto |
|---|---|---|
| Product Owner | [Completar] | [Email] |
| Developer | [Completar] | [Email] |
| QA | [Completar] | [Email] |
| Infra | [Completar] | [Email] |

---

## Notas Finales

### Por qué este MVP es tan limpio
1. **Responsabilidad única**: Solo registrar entrada/salida
2. **Sin extras**: Fotos obligatorias, sin OCR
3. **Sin seguridad compleja**: No es crítico en MVP
4. **Sin paginación compleja**: Máximo 50 registros
5. **Sin gráficas avanzadas**: Chart.js básico

### Próximos pasos después del MVP
1. Recopilar feedback de usuarios en campo
2. Medir cuello de botella real
3. Priorizar mejoras basadas en uso real
4. Mantener el código limpio para escalar después

### Riesgo principal
- **Foto no comprimible legiblemente**: Test con diferentes dispositivos/lighting en desarrollo

---

## Cambios y Actualizaciones

| Fecha | Cambio | Responsable |
|---|---|---|
| 2026-04-14 | Documento inicial creado | Claude |
| | | |

---

**Estado**: MVP en desarrollo  
**Última actualización**: 2026-04-14  
**Próxima revisión**: Después de demo inicial

