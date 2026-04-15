# CLAUDE.md - MVP Control de Recorridos Vehiculares

## Resumen Ejecutivo del Proyecto

**Nombre**: MVP Control de Recorridos Vehiculares  
**Objetivo**: Aplicación web mobile-first para registrar salidas y regresos de vehículos mediante escaneo QR  
**Plazo**: Implementación rápida, demo funcional mañana temprano  
**Stack**: Next.js + Supabase + Vercel + Chart.js  
**Prioridad**: Rapidez, funcionalidad, presentabilidad. No arquitectura compleja.

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js)                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Pages/Routes:                                    │  │
│  │  - / (Home/Scan QR)                             │  │
│  │  - /vehiculo/[codigo] (Detección de estado)     │  │
│  │  - /salida (Formulario de salida)               │  │
│  │  - /regreso (Formulario de regreso)             │  │
│  │  - /historico (Histórico + filtros)             │  │
│  │  - /indicadores (Gráficas + estadísticas)       │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Servicios:                                       │  │
│  │  - supabase.ts (Cliente Supabase)               │  │
│  │  - imageCompression.ts (Compresión de fotos)    │  │
│  │  - qrDecoder.ts (Decodificación QR)             │  │
│  │  - calculations.ts (Cálculos: km, costo, etc)   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Componentes reutilizables:                       │  │
│  │  - Button, Input, Select, FormField             │  │
│  │  - PhotoCapture, PhotoPreview                   │  │
│  │  - HistoricoTable, IndicadorCard                │  │
│  │  - FilterPanel                                  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
    ┌────────────┐     ┌──────────────┐     ┌─────────────┐
    │ Supabase   │     │ Supabase     │     │   Vercel    │
    │ Database   │     │   Storage    │     │   (Deploy)  │
    │ (Postgres) │     │ (Fotos JPG)  │     │             │
    └────────────┘     └──────────────┘     └─────────────┘
```

---

## Modelo de Datos (SQL)

### Tabla: `recorridos`

```sql
CREATE TABLE recorridos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_codigo VARCHAR(50) NOT NULL,
  conductor VARCHAR(100) NOT NULL,
  centro_costo VARCHAR(100) NOT NULL,
  
  -- Datos de salida
  fecha_salida TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  km_salida INTEGER NOT NULL,
  combustible_salida VARCHAR(20) NOT NULL,
  foto_salida_path TEXT NOT NULL,
  
  -- Datos de regreso (nullable hasta que se cierre)
  fecha_regreso TIMESTAMP WITH TIME ZONE,
  km_regreso INTEGER,
  combustible_regreso VARCHAR(20),
  foto_regreso_path TEXT,
  litros_cargados DECIMAL(10, 2),
  precio_litro DECIMAL(10, 2),
  
  -- Estado
  estado VARCHAR(20) DEFAULT 'abierto', -- 'abierto' o 'cerrado'
  
  -- Timestamps de auditoría
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT check_km_final_mayor_igual_inicial 
    CHECK (km_regreso IS NULL OR km_regreso >= km_salida),
  CONSTRAINT check_estado_valido 
    CHECK (estado IN ('abierto', 'cerrado'))
);

-- Índices para queries frecuentes
CREATE INDEX idx_vehiculo_codigo ON recorridos(vehiculo_codigo);
CREATE INDEX idx_estado ON recorridos(estado);
CREATE INDEX idx_vehiculo_estado ON recorridos(vehiculo_codigo, estado);
CREATE INDEX idx_fecha_salida ON recorridos(fecha_salida);
```

### Tabla: `vehiculos` (opcional pero recomendada)

```sql
CREATE TABLE vehiculos (
  codigo VARCHAR(50) PRIMARY KEY,
  marca_modelo VARCHAR(100),
  placa VARCHAR(20) UNIQUE,
  estado VARCHAR(20) DEFAULT 'activo', -- 'activo' o 'inactivo'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agregar restricción de clave foránea a recorridos
ALTER TABLE recorridos 
ADD CONSTRAINT fk_vehiculo_codigo 
FOREIGN KEY (vehiculo_codigo) REFERENCES vehiculos(codigo);
```

### Tabla: `centros_costo` (datos maestros)

```sql
CREATE TABLE centros_costo (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Datos de ejemplo
INSERT INTO centros_costo (codigo, nombre) VALUES
('CC001', 'Centro Administrativo'),
('CC002', 'Centro de Distribución'),
('CC003', 'Centro de Servicio'),
('CC004', 'Depósito Regional'),
('CC005', 'Otra ubicación');
```

### Campos Calculados (No se almacenan, se calculan en el frontend/query)

```
km_recorridos = km_regreso - km_salida
importe = litros_cargados * precio_litro
rendimiento = km_recorridos / litros_cargados (km/litro)
```

---

## Estructura de Carpetas del Proyecto

```
control-recorridos/
├── .env.local                          # Variables de entorno (local)
├── .env.example                        # Template de variables
├── .gitignore
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
│
├── public/
│   ├── qr-placeholder.png             # Imagen de ejemplo para QR
│   └── assets/                        # Logos, iconos
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # Layout global
│   │   ├── page.tsx                   # Home / Escaneo QR
│   │   ├── vehiculo/
│   │   │   └── [codigo]/
│   │   │       └── page.tsx           # Detección de estado del vehículo
│   │   ├── salida/
│   │   │   └── page.tsx               # Formulario de salida
│   │   ├── regreso/
│   │   │   └── page.tsx               # Formulario de regreso
│   │   ├── historico/
│   │   │   └── page.tsx               # Histórico con filtros
│   │   ├── indicadores/
│   │   │   └── page.tsx               # Gráficas y estadísticas
│   │   └── api/                       # API routes si son necesarias
│   │       └── (aquí solo si usamos server actions)
│   │
│   ├── components/
│   │   ├── common/
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── Loading.tsx
│   │   │   ├── ErrorMessage.tsx
│   │   │   └── SuccessMessage.tsx
│   │   ├── forms/
│   │   │   ├── PhotoCapture.tsx       # Captura de foto con preview
│   │   │   ├── FormSalida.tsx         # Lógica del formulario de salida
│   │   │   ├── FormRegreso.tsx        # Lógica del formulario de regreso
│   │   │   └── FilterPanel.tsx        # Filtros de histórico
│   │   ├── display/
│   │   │   ├── HistoricoTable.tsx
│   │   │   ├── IndicadorCard.tsx
│   │   │   └── ChartContainer.tsx
│   │   └── QRScanner.tsx              # Scanner QR
│   │
│   ├── lib/
│   │   ├── supabase.ts                # Cliente Supabase
│   │   ├── imageCompression.ts        # Compresión de fotos
│   │   ├── qrDecoder.ts               # Decodificación QR
│   │   ├── calculations.ts            # Cálculos (km, costo, etc)
│   │   ├── constants.ts               # Constantes (niveles combustible, etc)
│   │   └── validations.ts             # Validaciones
│   │
│   ├── types/
│   │   ├── index.ts                   # Tipos TypeScript globales
│   │   └── models.ts                  # Tipos de modelos (Recorrido, Vehículo, etc)
│   │
│   ├── utils/
│   │   ├── formatters.ts              # Formateo de fechas, moneda, etc
│   │   ├── helpers.ts                 # Helpers generales
│   │   └── storage.ts                 # Helpers para Supabase Storage
│   │
│   └── styles/
│       ├── globals.css                # Estilos globales
│       └── tailwind.css               # Config de Tailwind
│
└── README.md
```

---

## Flujo de Lógica Principal

### 1. Escaneo QR → Identificación de Vehículo

```
Usuario escanea QR
    ↓
QR contiene URL: https://app.vercel.app/vehiculo/VEH001
    ↓
App navega a: /vehiculo/[codigo]
    ↓
Frontend extrae el código del vehículo (VEH001)
    ↓
Query Supabase: SELECT * FROM recorridos 
                WHERE vehiculo_codigo='VEH001' AND estado='abierto'
    ↓
Si existe → Mostrar formulario de REGRESO
Si NO existe → Mostrar formulario de SALIDA
```

### 2. Formulario de Salida

```
Usuario completa:
  - Conductor (input text)
  - Centro de costo (select dropdown)
  - km_salida (number)
  - combustible_salida (select: Vacío/1/4/1/2/3/4/Lleno)
  - Foto del tablero (captura con preview)
    ↓
Validaciones:
  ✓ Todos los campos requeridos
  ✓ km_salida es número positivo
  ✓ Foto está presente
  ✓ NO hay recorrido abierto para este vehículo
    ↓
Si pasa validaciones:
  1. Comprimir foto en cliente
  2. Subir foto a Supabase Storage: vehiculos/VEH001/recorridos/{id}/salida.jpg
  3. Insertar en tabla recorridos:
     - vehiculo_codigo: VEH001
     - conductor: (input)
     - centro_costo: (select)
     - km_salida: (input)
     - combustible_salida: (select)
     - foto_salida_path: (ruta en storage)
     - estado: 'abierto'
     - fecha_salida: NOW()
    ↓
Mostrar: "Salida registrada. Vehículo en ruta."
Redirigir a: /vehiculo/VEH001 o home después de 2 segundos
```

### 3. Formulario de Regreso

```
Usuario completa:
  - km_regreso (number)
  - combustible_regreso (select)
  - Foto del tablero (captura con preview)
  - litros_cargados (decimal)
  - precio_litro (decimal)
    ↓
Validaciones:
  ✓ Todos los campos requeridos
  ✓ km_regreso >= km_salida (del recorrido abierto)
  ✓ Foto está presente
  ✓ Existe recorrido abierto para este vehículo
    ↓
Si pasa validaciones:
  1. Comprimir foto en cliente
  2. Subir foto a Supabase Storage: vehiculos/VEH001/recorridos/{id}/regreso.jpg
  3. Actualizar recorrido abierto:
     - km_regreso: (input)
     - combustible_regreso: (select)
     - foto_regreso_path: (ruta)
     - litros_cargados: (input)
     - precio_litro: (input)
     - estado: 'cerrado'
     - fecha_regreso: NOW()
    ↓
Mostrar: "Regreso registrado. Recorrido cerrado."
Redirigir a: /historico o home
```

---

## Validaciones Críticas (Frontend + Backend)

### En Frontend (prevención temprana)

- [ ] Todos los campos requeridos están completos
- [ ] km_regreso >= km_salida
- [ ] Foto capturada y lista para subir
- [ ] Valores numéricos son válidos (positivos, decimales correctos)

### En Supabase (constraints + policies)

- [ ] CHECK: km_regreso IS NULL OR km_regreso >= km_salida
- [ ] CHECK: estado IN ('abierto', 'cerrado')
- [ ] UNIQUE: Un solo recorrido abierto por vehículo (verificar en app antes de crear)

### Reglas de Negocio

1. **No crear recorrido si ya hay uno abierto**
   - Query antes de INSERT: `SELECT * FROM recorridos WHERE vehiculo_codigo=X AND estado='abierto'`
   - Si existe → mostrar error, no permitir crear

2. **No cerrar si no hay abierto**
   - Query antes de UPDATE: `SELECT * FROM recorridos WHERE vehiculo_codigo=X AND estado='abierto'`
   - Si no existe → mostrar error

3. **No editar después de cerrado**
   - En el frontend: si estado='cerrado', no mostrar botón de edición
   - En Supabase: RLS policy deniega UPDATE si estado='cerrado'

---

## Configuración de Variables de Entorno (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Storage (derivado de SUPABASE_URL, no necesita config extra)
# Las fotos se suben a bucket: "recorridos"

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
# En Vercel: https://control-recorridos.vercel.app
```

---

## Tecnologías y Librerías Específicas

| Funcionalidad | Librería | Versión |
|---|---|---|
| Frontend | Next.js (App Router) | ^14.0.0 |
| BD + Auth | Supabase | ^2.38.0 |
| UI/Estilos | Tailwind CSS | ^3.3.0 |
| QR Scanner | html5-qrcode | ^2.3.8 |
| Compresión Imágenes | browser-image-compression | ^2.0.2 |
| Gráficas | Chart.js + react-chartjs-2 | ^4.4.0 |
| Validación | Zod | ^3.22.0 |
| Manejo de fechas | date-fns | ^2.30.0 |

---

## Prioridad de Implementación (MVP rápido)

### Fase 1: Setup + Core (2-3 horas)
1. [ ] Crear proyecto Next.js
2. [ ] Conectar Supabase (BD + Storage)
3. [ ] Crear tablas en Supabase
4. [ ] Variables de entorno
5. [ ] Cliente Supabase en el frontend

### Fase 2: Escaneo + Detección (1-2 horas)
6. [ ] Página home con QR scanner
7. [ ] Página /vehiculo/[codigo] con detección de estado
8. [ ] Lógica para determinar si mostrar salida o regreso

### Fase 3: Formularios (2-3 horas)
9. [ ] Componente PhotoCapture con preview
10. [ ] Compresión de imágenes
11. [ ] Formulario de salida (UI + lógica)
12. [ ] Formulario de regreso (UI + lógica)
13. [ ] Subida de fotos a Storage
14. [ ] Guardado en Supabase

### Fase 4: Histórico + Filtros (1-2 horas)
15. [ ] Página histórico con tabla
16. [ ] Filtros por vehículo, semana, mes
17. [ ] Cálculos de campos derivados

### Fase 5: Indicadores + Gráficas (1-2 horas)
18. [ ] Página indicadores
19. [ ] Gráficas con Chart.js
20. [ ] Cálculos de estadísticas

### Fase 6: Pulido + Deploy (1 hora)
21. [ ] Validaciones y manejo de errores
22. [ ] Tests básicos
23. [ ] Deploy en Vercel

---

## Decisiones Arquitectónicas

### ¿Por qué sin autenticación?
- MVP rápido. La app está diseñada para usarse en campo. El conductor se identifica en cada uso.

### ¿Por qué sin backend API personalizada?
- Supabase client-side es suficiente. Menos complejidad, deploy más rápido.

### ¿Por qué compresión en cliente?
- Más rápido, menos carga en servidor, usuario ve feedback inmediato.

### ¿Por qué Tailwind + componentes simples?
- Desarrollo rápido, responsive automático, sin CSS personalizado.

### ¿Por qué Chart.js sin librerías complejas?
- Gráficas simples, configuración directa, bundle size pequeño.

---

## Checklist Final para Demo

- [ ] QR scanning funciona
- [ ] Detección de estado (abierto/cerrado) es correcta
- [ ] Formulario de salida guarda datos y foto
- [ ] Formulario de regreso guarda datos y foto
- [ ] Foto se comprime y es legible
- [ ] Histórico muestra registros
- [ ] Filtros por vehículo, semana, mes funcionan
- [ ] Indicadores se calculan correctamente
- [ ] Gráficas se renderizan sin errores
- [ ] App es responsive en mobile
- [ ] Deploy en Vercel funciona

---

## Notas Importantes

1. **Sin RLS en MVP**: Las políticas de seguridad de Supabase (Row Level Security) no son críticas para MVP. Se agregarán después.
2. **Sin triggers ni funciones avanzadas**: Todo se calcula en el frontend con datos que trae de la BD.
3. **Fotos en Storage**: Las URLs públicas se almacenan en la BD. No necesita autenticación para leer (Storage es público por defecto en MVP).
4. **Conexión estable**: Asumir que siempre hay internet. No hay manejo de offline.
5. **Mobile-first**: Diseño enfocado en celular, pero funciona en escritorio también.

---

## Contacto y Cambios Futuros

Este documento describe el MVP exacto. Cualquier funcionalidad fuera del scope debe ir a `MEMORY.md` como "mejoras futuras" o "scope futuro".

Para cambios en el MVP después del deploy inicial:
- Actualizar este archivo
- Documentar en MEMORY.md
- Comunicar al equipo

