


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."auto_asociar_cargas_al_cerrar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.estado = 'cerrado' AND OLD.estado = 'abierto' AND NEW.km_regreso IS NOT NULL THEN
    WITH candidatos AS (
      SELECT cg.id
      FROM cargas_gasolina cg
      WHERE cg.recorrido_id IS NULL
        AND cg.vehiculo_codigo = NEW.vehiculo_codigo
        AND cg.km_antes BETWEEN NEW.km_salida AND NEW.km_regreso
        AND cg.created_at BETWEEN NEW.fecha_salida AND NEW.fecha_regreso
        -- solo si este recorrido es el ÚNICO candidato
        AND NOT EXISTS (
          SELECT 1 FROM recorridos r2
          WHERE r2.id <> NEW.id
            AND r2.vehiculo_codigo = NEW.vehiculo_codigo
            AND r2.km_salida <= cg.km_antes
            AND (r2.km_regreso IS NULL OR r2.km_regreso >= cg.km_antes)
            AND r2.fecha_salida <= cg.created_at
            AND (r2.fecha_regreso IS NULL OR r2.fecha_regreso >= cg.created_at)
        )
    )
    UPDATE cargas_gasolina
    SET recorrido_id = NEW.id
    WHERE id IN (SELECT id FROM candidatos);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_asociar_cargas_al_cerrar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_fotos_cargas_nuevas"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.observaciones IS NULL OR NEW.observaciones NOT LIKE 'MIGRADO%' THEN
    IF NEW.foto_tablero_antes_path IS NULL THEN
      RAISE EXCEPTION 'foto_tablero_antes_path es obligatoria';
    END IF;
    IF NEW.foto_tablero_despues_path IS NULL THEN
      RAISE EXCEPTION 'foto_tablero_despues_path es obligatoria';
    END IF;
    IF NEW.foto_ticket_path IS NULL THEN
      RAISE EXCEPTION 'foto_ticket_path es obligatoria';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_fotos_cargas_nuevas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_fuel_por_recorridos"("p_recorrido_ids" "uuid"[]) RETURNS TABLE("recorrido_id" "uuid", "litros" numeric, "costo" numeric, "n_cargas" integer, "fuente" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Fase 1: cargas con recorrido_id ya asignado
  RETURN QUERY
  SELECT
    cg.recorrido_id,
    SUM(cg.litros_cargados)::NUMERIC,
    SUM(cg.litros_cargados * cg.precio_litro)::NUMERIC,
    COUNT(*)::INT,
    'directo'::TEXT
  FROM cargas_gasolina cg
  WHERE cg.recorrido_id = ANY(p_recorrido_ids)
  GROUP BY cg.recorrido_id;

  -- Fase 2: cargas sin recorrido_id, asociadas por km+fecha+vehiculo
  RETURN QUERY
  WITH candidatos AS (
    SELECT
      cg.id AS carga_id,
      r.id AS recorrido_id,
      cg.litros_cargados,
      cg.precio_litro,
      COUNT(*) OVER (PARTITION BY cg.id) AS n_candidatos
    FROM cargas_gasolina cg
    JOIN recorridos r ON
      r.id = ANY(p_recorrido_ids)
      AND r.vehiculo_codigo = cg.vehiculo_codigo
      AND r.km_salida <= cg.km_antes
      AND (r.km_regreso IS NULL OR r.km_regreso >= cg.km_antes)
      AND r.fecha_salida <= cg.created_at
      AND (r.fecha_regreso IS NULL OR r.fecha_regreso >= cg.created_at)
    WHERE cg.recorrido_id IS NULL
  )
  SELECT
    candidatos.recorrido_id,
    SUM(candidatos.litros_cargados)::NUMERIC,
    SUM(candidatos.litros_cargados * candidatos.precio_litro)::NUMERIC,
    COUNT(*)::INT,
    CASE WHEN MAX(candidatos.n_candidatos) = 1 THEN 'km_match' ELSE 'ambiguo' END::TEXT
  FROM candidatos
  WHERE n_candidatos = 1  -- excluir ambiguos del cómputo automático
  GROUP BY candidatos.recorrido_id;
END;
$$;


ALTER FUNCTION "public"."get_fuel_por_recorridos"("p_recorrido_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_centro_costo"("p_nombre" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_id INTEGER;
  v_nombre_normalizado TEXT;
  v_codigo TEXT;
BEGIN
  v_nombre_normalizado := INITCAP(TRIM(p_nombre));

  IF v_nombre_normalizado IS NULL OR v_nombre_normalizado = '' THEN
    RAISE EXCEPTION 'El nombre del centro de costo no puede estar vacío';
  END IF;

  SELECT id INTO v_id
  FROM centros_costo
  WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(v_nombre_normalizado))
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  v_codigo := 'M-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 12);

  INSERT INTO centros_costo (codigo, nombre, estado, origen, es_eventual, observaciones)
  VALUES (v_codigo, v_nombre_normalizado, 'activo', 'manual', TRUE, 'Creado automáticamente desde captura operativa')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."get_or_create_centro_costo"("p_nombre" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_conductor"("p_nombre" "text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_id INTEGER;
  v_nombre_normalizado TEXT;
BEGIN
  v_nombre_normalizado := INITCAP(TRIM(p_nombre));

  IF v_nombre_normalizado IS NULL OR v_nombre_normalizado = '' THEN
    RAISE EXCEPTION 'El nombre del conductor no puede estar vacío';
  END IF;

  SELECT id
  INTO v_id
  FROM conductores
  WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(v_nombre_normalizado))
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO conductores (
    nombre,
    numero_empleado,
    estado,
    origen,
    es_eventual,
    observaciones
  )
  VALUES (
    v_nombre_normalizado,
    NULL,
    'activo',
    'manual',
    TRUE,
    'Creado automáticamente desde captura operativa'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."get_or_create_conductor"("p_nombre" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_siguiente_accion_por_vehiculo"("p_vehiculo_codigo" "text") RETURNS TABLE("accion" "text", "recorrido_id" "uuid", "parada_id" "uuid", "orden" smallint, "centro_costo_id" integer)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_recorrido_id UUID;
BEGIN
  SELECT r.id
  INTO v_recorrido_id
  FROM recorridos r
  WHERE r.vehiculo_codigo = p_vehiculo_codigo
    AND r.estado = 'abierto'
  ORDER BY r.fecha_salida DESC
  LIMIT 1;

  IF v_recorrido_id IS NULL THEN
    RETURN QUERY
    SELECT
      'sin_recorrido_abierto'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::SMALLINT,
      NULL::INTEGER;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    x.accion,
    v_recorrido_id,
    x.parada_id,
    x.orden,
    x.centro_costo_id
  FROM get_siguiente_accion_recorrido(v_recorrido_id) x;
END;
$$;


ALTER FUNCTION "public"."get_siguiente_accion_por_vehiculo"("p_vehiculo_codigo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_siguiente_accion_recorrido"("p_recorrido_id" "uuid") RETURNS TABLE("accion" "text", "parada_id" "uuid", "orden" smallint, "centro_costo_id" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    'parada'::TEXT,
    rp.id,
    rp.orden,
    rp.centro_costo_id
  FROM recorridos_paradas rp
  WHERE rp.recorrido_id = p_recorrido_id
    AND rp.estado = 'pendiente'
  ORDER BY rp.orden
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'cerrar'::TEXT,
      NULL::UUID,
      NULL::SMALLINT,
      NULL::INTEGER;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_siguiente_accion_recorrido"("p_recorrido_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Solo cuando el recorrido quede cerrado y tenga km_regreso
  IF NEW.estado = 'cerrado' AND NEW.km_regreso IS NOT NULL THEN
    UPDATE vehiculos
    SET km_actual = GREATEST(km_actual, NEW.km_regreso)
    WHERE codigo = NEW.vehiculo_codigo;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_km_parada"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_km_referencia INTEGER;
BEGIN
  -- Si no se informa km_parada aun, no validamos
  IF NEW.km_parada IS NULL THEN
    RETURN NEW;
  END IF;

  -- Buscar el km de referencia:
  -- 1) la parada completada anterior
  -- 2) si no existe, el km_salida del recorrido
  SELECT rp.km_parada
  INTO v_km_referencia
  FROM recorridos_paradas rp
  WHERE rp.recorrido_id = NEW.recorrido_id
    AND rp.orden < NEW.orden
    AND rp.estado = 'completada'
  ORDER BY rp.orden DESC
  LIMIT 1;

  IF v_km_referencia IS NULL THEN
    SELECT r.km_salida
    INTO v_km_referencia
    FROM recorridos r
    WHERE r.id = NEW.recorrido_id;
  END IF;

  IF NEW.km_parada < v_km_referencia THEN
    RAISE EXCEPTION
      'El km_parada (%) no puede ser menor al kilometraje previo (%)',
      NEW.km_parada, v_km_referencia;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_km_parada"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_km_recorrido"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_km_actual INTEGER;
BEGIN
  SELECT km_actual
  INTO v_km_actual
  FROM vehiculos
  WHERE codigo = NEW.vehiculo_codigo;

  IF v_km_actual IS NULL THEN
    RAISE EXCEPTION 'No existe kilometraje base para el vehículo %', NEW.vehiculo_codigo;
  END IF;

  -- Validar contra km_actual solo en inserción,
  -- o si en update cambió km_salida o cambió el vehículo
  IF TG_OP = 'INSERT'
     OR NEW.km_salida IS DISTINCT FROM OLD.km_salida
     OR NEW.vehiculo_codigo IS DISTINCT FROM OLD.vehiculo_codigo THEN

    IF NEW.km_salida < v_km_actual THEN
      RAISE EXCEPTION
        'El km_salida (%) no puede ser menor al km_actual del vehículo (%)',
        NEW.km_salida, v_km_actual;
    END IF;
  END IF;

  IF NEW.km_regreso IS NOT NULL AND NEW.km_regreso < NEW.km_salida THEN
    RAISE EXCEPTION
      'El km_regreso (%) no puede ser menor al km_salida (%)',
      NEW.km_regreso, NEW.km_salida;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_km_recorrido"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."cargas_gasolina" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehiculo_codigo" character varying(20) NOT NULL,
    "conductor_id" integer NOT NULL,
    "recorrido_id" "uuid",
    "km_antes" integer NOT NULL,
    "combustible_antes" smallint NOT NULL,
    "foto_tablero_antes_path" "text",
    "combustible_despues" smallint NOT NULL,
    "litros_cargados" numeric(10,3) NOT NULL,
    "precio_litro" numeric(10,3) NOT NULL,
    "foto_tablero_despues_path" "text",
    "foto_ticket_path" "text",
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "check_carga_combustible_antes" CHECK ((("combustible_antes" >= 0) AND ("combustible_antes" <= 8))),
    CONSTRAINT "check_carga_combustible_despues" CHECK ((("combustible_despues" >= 0) AND ("combustible_despues" <= 8))),
    CONSTRAINT "check_carga_km_antes" CHECK (("km_antes" >= 0)),
    CONSTRAINT "check_carga_litros" CHECK (("litros_cargados" > (0)::numeric)),
    CONSTRAINT "check_carga_precio" CHECK (("precio_litro" > (0)::numeric))
);


ALTER TABLE "public"."cargas_gasolina" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."centros_costo" (
    "id" integer NOT NULL,
    "codigo" character varying(20) NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado" character varying(20) DEFAULT 'activo'::character varying NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origen" character varying(20) DEFAULT 'catalogo'::character varying NOT NULL,
    "es_eventual" boolean DEFAULT false NOT NULL,
    "observaciones" "text",
    CONSTRAINT "check_estado_centro_costo" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'inactivo'::character varying])::"text"[]))),
    CONSTRAINT "check_origen_centro_costo" CHECK ((("origen")::"text" = ANY ((ARRAY['catalogo'::character varying, 'manual'::character varying])::"text"[])))
);


ALTER TABLE "public"."centros_costo" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."centros_costo_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."centros_costo_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."centros_costo_id_seq" OWNED BY "public"."centros_costo"."id";



CREATE TABLE IF NOT EXISTS "public"."conductores" (
    "id" integer NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "numero_empleado" character varying(30),
    "estado" character varying(20) DEFAULT 'activo'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origen" character varying(20) DEFAULT 'catalogo'::character varying NOT NULL,
    "es_eventual" boolean DEFAULT false NOT NULL,
    "observaciones" "text",
    CONSTRAINT "check_estado_conductor" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'inactivo'::character varying])::"text"[]))),
    CONSTRAINT "check_origen_conductor" CHECK ((("origen")::"text" = ANY ((ARRAY['catalogo'::character varying, 'manual'::character varying])::"text"[])))
);


ALTER TABLE "public"."conductores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."conductores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."conductores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."conductores_id_seq" OWNED BY "public"."conductores"."id";



CREATE TABLE IF NOT EXISTS "public"."recorridos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehiculo_codigo" character varying(20) NOT NULL,
    "conductor_id" integer NOT NULL,
    "centro_costo_id" integer NOT NULL,
    "fecha_salida" timestamp with time zone DEFAULT "now"() NOT NULL,
    "km_salida" integer NOT NULL,
    "combustible_salida" smallint NOT NULL,
    "foto_salida_path" "text" NOT NULL,
    "fecha_regreso" timestamp with time zone,
    "km_regreso" integer,
    "combustible_regreso" smallint,
    "foto_regreso_path" "text",
    "litros_cargados" numeric(10,3),
    "precio_litro" numeric(10,3),
    "estado" character varying(20) DEFAULT 'abierto'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "usa_paradas" boolean DEFAULT false NOT NULL,
    CONSTRAINT "check_combustible_regreso" CHECK ((("combustible_regreso" IS NULL) OR (("combustible_regreso" >= 0) AND ("combustible_regreso" <= 8)))),
    CONSTRAINT "check_combustible_salida" CHECK ((("combustible_salida" >= 0) AND ("combustible_salida" <= 8))),
    CONSTRAINT "check_estado_valido" CHECK ((("estado")::"text" = ANY ((ARRAY['abierto'::character varying, 'cerrado'::character varying])::"text"[]))),
    CONSTRAINT "check_km_final_mayor_igual_inicial" CHECK ((("km_regreso" IS NULL) OR ("km_regreso" >= "km_salida"))),
    CONSTRAINT "check_km_salida" CHECK (("km_salida" >= 0)),
    CONSTRAINT "check_litros_cargados" CHECK ((("litros_cargados" IS NULL) OR ("litros_cargados" >= (0)::numeric))),
    CONSTRAINT "check_precio_litro" CHECK ((("precio_litro" IS NULL) OR ("precio_litro" >= (0)::numeric)))
);


ALTER TABLE "public"."recorridos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recorridos_paradas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recorrido_id" "uuid" NOT NULL,
    "orden" smallint NOT NULL,
    "centro_costo_id" integer NOT NULL,
    "fecha_parada" timestamp with time zone,
    "km_parada" integer,
    "combustible_parada" smallint,
    "foto_parada_path" "text",
    "litros_cargados" numeric(10,3),
    "precio_litro" numeric(10,3),
    "estado" character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "check_combustible_parada" CHECK ((("combustible_parada" IS NULL) OR (("combustible_parada" >= 0) AND ("combustible_parada" <= 8)))),
    CONSTRAINT "check_km_parada" CHECK ((("km_parada" IS NULL) OR ("km_parada" >= 0))),
    CONSTRAINT "check_litros_cargados_parada" CHECK ((("litros_cargados" IS NULL) OR ("litros_cargados" >= (0)::numeric))),
    CONSTRAINT "check_parada_completada_con_datos" CHECK (((("estado")::"text" = 'pendiente'::"text") OR ((("estado")::"text" = 'completada'::"text") AND ("fecha_parada" IS NOT NULL) AND ("km_parada" IS NOT NULL) AND ("combustible_parada" IS NOT NULL) AND ("foto_parada_path" IS NOT NULL)))),
    CONSTRAINT "check_parada_estado" CHECK ((("estado")::"text" = ANY ((ARRAY['pendiente'::character varying, 'completada'::character varying])::"text"[]))),
    CONSTRAINT "check_parada_orden" CHECK (("orden" > 0)),
    CONSTRAINT "check_precio_litro_parada" CHECK ((("precio_litro" IS NULL) OR ("precio_litro" >= (0)::numeric)))
);


ALTER TABLE "public"."recorridos_paradas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehiculos" (
    "codigo" character varying(20) NOT NULL,
    "apodo" character varying(50),
    "marca" character varying(50),
    "modelo" character varying(50),
    "anio" smallint,
    "placa" character varying(20),
    "numero_serie" character varying(50),
    "capacidad_tanque_litros" numeric(8,2) NOT NULL,
    "centro_costo_id" integer,
    "estado" character varying(20) DEFAULT 'activo'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "km_actual" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "check_anio_vehiculo" CHECK ((("anio" IS NULL) OR (("anio" >= 1980) AND ("anio" <= 2100)))),
    CONSTRAINT "check_capacidad_tanque" CHECK (("capacidad_tanque_litros" > (0)::numeric)),
    CONSTRAINT "check_estado_vehiculo" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'inactivo'::character varying])::"text"[]))),
    CONSTRAINT "check_vehiculos_km_actual" CHECK (("km_actual" >= 0))
);


ALTER TABLE "public"."vehiculos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehiculos_bajas" (
    "id" integer NOT NULL,
    "vehiculo_codigo" character varying(20) NOT NULL,
    "motivo" "text" NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" character varying(20) DEFAULT 'baja'::character varying NOT NULL,
    CONSTRAINT "vehiculos_bajas_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['baja'::character varying, 'reactivacion'::character varying])::"text"[])))
);


ALTER TABLE "public"."vehiculos_bajas" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vehiculos_bajas_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vehiculos_bajas_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vehiculos_bajas_id_seq" OWNED BY "public"."vehiculos_bajas"."id";



ALTER TABLE ONLY "public"."centros_costo" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."centros_costo_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."conductores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."conductores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vehiculos_bajas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vehiculos_bajas_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cargas_gasolina"
    ADD CONSTRAINT "cargas_gasolina_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."centros_costo"
    ADD CONSTRAINT "centros_costo_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."centros_costo"
    ADD CONSTRAINT "centros_costo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conductores"
    ADD CONSTRAINT "conductores_numero_empleado_key" UNIQUE ("numero_empleado");



ALTER TABLE ONLY "public"."conductores"
    ADD CONSTRAINT "conductores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorridos_paradas"
    ADD CONSTRAINT "recorridos_paradas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorridos"
    ADD CONSTRAINT "recorridos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recorridos_paradas"
    ADD CONSTRAINT "uq_recorrido_parada_orden" UNIQUE ("recorrido_id", "orden");



ALTER TABLE ONLY "public"."vehiculos_bajas"
    ADD CONSTRAINT "vehiculos_bajas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehiculos"
    ADD CONSTRAINT "vehiculos_numero_serie_key" UNIQUE ("numero_serie");



ALTER TABLE ONLY "public"."vehiculos"
    ADD CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("codigo");



ALTER TABLE ONLY "public"."vehiculos"
    ADD CONSTRAINT "vehiculos_placa_key" UNIQUE ("placa");



CREATE INDEX "idx_cargas_conductor" ON "public"."cargas_gasolina" USING "btree" ("conductor_id");



CREATE INDEX "idx_cargas_fecha" ON "public"."cargas_gasolina" USING "btree" ("created_at");



CREATE INDEX "idx_cargas_recorrido" ON "public"."cargas_gasolina" USING "btree" ("recorrido_id");



CREATE INDEX "idx_cargas_vehiculo" ON "public"."cargas_gasolina" USING "btree" ("vehiculo_codigo");



CREATE INDEX "idx_cargas_vehiculo_fecha" ON "public"."cargas_gasolina" USING "btree" ("vehiculo_codigo", "created_at" DESC);



CREATE INDEX "idx_centros_costo_es_eventual" ON "public"."centros_costo" USING "btree" ("es_eventual");



CREATE INDEX "idx_centros_costo_estado" ON "public"."centros_costo" USING "btree" ("estado");



CREATE INDEX "idx_centros_costo_estado_codigo" ON "public"."centros_costo" USING "btree" ("estado", "codigo");



CREATE INDEX "idx_centros_costo_estado_nombre" ON "public"."centros_costo" USING "btree" ("estado", "nombre");



CREATE INDEX "idx_centros_costo_origen" ON "public"."centros_costo" USING "btree" ("origen");



CREATE INDEX "idx_conductores_estado" ON "public"."conductores" USING "btree" ("estado");



CREATE INDEX "idx_conductores_estado_nombre" ON "public"."conductores" USING "btree" ("estado", "nombre");



CREATE INDEX "idx_conductores_nombre" ON "public"."conductores" USING "btree" ("nombre");



CREATE INDEX "idx_recorridos_centro_costo_id" ON "public"."recorridos" USING "btree" ("centro_costo_id");



CREATE INDEX "idx_recorridos_conductor_id" ON "public"."recorridos" USING "btree" ("conductor_id");



CREATE INDEX "idx_recorridos_estado" ON "public"."recorridos" USING "btree" ("estado");



CREATE INDEX "idx_recorridos_fecha_salida" ON "public"."recorridos" USING "btree" ("fecha_salida");



CREATE INDEX "idx_recorridos_paradas_centro_costo_id" ON "public"."recorridos_paradas" USING "btree" ("centro_costo_id");



CREATE INDEX "idx_recorridos_paradas_estado" ON "public"."recorridos_paradas" USING "btree" ("estado");



CREATE INDEX "idx_recorridos_paradas_recorrido_estado" ON "public"."recorridos_paradas" USING "btree" ("recorrido_id", "estado");



CREATE INDEX "idx_recorridos_paradas_recorrido_id" ON "public"."recorridos_paradas" USING "btree" ("recorrido_id");



CREATE INDEX "idx_recorridos_paradas_recorrido_orden" ON "public"."recorridos_paradas" USING "btree" ("recorrido_id", "orden");



CREATE INDEX "idx_recorridos_usa_paradas" ON "public"."recorridos" USING "btree" ("usa_paradas");



CREATE INDEX "idx_recorridos_vehiculo_codigo" ON "public"."recorridos" USING "btree" ("vehiculo_codigo");



CREATE INDEX "idx_recorridos_vehiculo_estado" ON "public"."recorridos" USING "btree" ("vehiculo_codigo", "estado");



CREATE INDEX "idx_vehiculos_centro_costo" ON "public"."vehiculos" USING "btree" ("centro_costo_id");



CREATE INDEX "idx_vehiculos_km_actual" ON "public"."vehiculos" USING "btree" ("km_actual");



CREATE INDEX "idx_vehiculos_numero_serie" ON "public"."vehiculos" USING "btree" ("numero_serie");



CREATE INDEX "idx_vehiculos_placa" ON "public"."vehiculos" USING "btree" ("placa");



CREATE UNIQUE INDEX "ux_recorrido_abierto_por_vehiculo" ON "public"."recorridos" USING "btree" ("vehiculo_codigo") WHERE (("estado")::"text" = 'abierto'::"text");



CREATE OR REPLACE TRIGGER "trg_auto_asociar_cargas" AFTER UPDATE ON "public"."recorridos" FOR EACH ROW EXECUTE FUNCTION "public"."auto_asociar_cargas_al_cerrar"();



CREATE OR REPLACE TRIGGER "trg_cargas_gasolina_updated_at" BEFORE UPDATE ON "public"."cargas_gasolina" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_centros_costo_updated_at" BEFORE UPDATE ON "public"."centros_costo" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_check_fotos_cargas" BEFORE INSERT ON "public"."cargas_gasolina" FOR EACH ROW EXECUTE FUNCTION "public"."check_fotos_cargas_nuevas"();



CREATE OR REPLACE TRIGGER "trg_conductores_updated_at" BEFORE UPDATE ON "public"."conductores" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_recorridos_paradas_updated_at" BEFORE UPDATE ON "public"."recorridos_paradas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_recorridos_updated_at" BEFORE UPDATE ON "public"."recorridos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_km_actual_vehiculo_desde_recorrido" AFTER INSERT OR UPDATE ON "public"."recorridos" FOR EACH ROW EXECUTE FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"();



CREATE OR REPLACE TRIGGER "trg_validar_km_parada" BEFORE INSERT OR UPDATE ON "public"."recorridos_paradas" FOR EACH ROW EXECUTE FUNCTION "public"."validar_km_parada"();



CREATE OR REPLACE TRIGGER "trg_validar_km_recorrido" BEFORE INSERT OR UPDATE ON "public"."recorridos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_km_recorrido"();



CREATE OR REPLACE TRIGGER "trg_vehiculos_updated_at" BEFORE UPDATE ON "public"."vehiculos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."cargas_gasolina"
    ADD CONSTRAINT "fk_carga_conductor" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductores"("id");



ALTER TABLE ONLY "public"."cargas_gasolina"
    ADD CONSTRAINT "fk_carga_recorrido" FOREIGN KEY ("recorrido_id") REFERENCES "public"."recorridos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cargas_gasolina"
    ADD CONSTRAINT "fk_carga_vehiculo" FOREIGN KEY ("vehiculo_codigo") REFERENCES "public"."vehiculos"("codigo");



ALTER TABLE ONLY "public"."recorridos"
    ADD CONSTRAINT "fk_centro_costo_id" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id");



ALTER TABLE ONLY "public"."recorridos"
    ADD CONSTRAINT "fk_conductor_id" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductores"("id");



ALTER TABLE ONLY "public"."recorridos_paradas"
    ADD CONSTRAINT "fk_parada_centro_costo" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id");



ALTER TABLE ONLY "public"."recorridos_paradas"
    ADD CONSTRAINT "fk_parada_recorrido" FOREIGN KEY ("recorrido_id") REFERENCES "public"."recorridos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recorridos"
    ADD CONSTRAINT "fk_vehiculo_codigo" FOREIGN KEY ("vehiculo_codigo") REFERENCES "public"."vehiculos"("codigo");



ALTER TABLE ONLY "public"."vehiculos_bajas"
    ADD CONSTRAINT "vehiculos_bajas_vehiculo_codigo_fkey" FOREIGN KEY ("vehiculo_codigo") REFERENCES "public"."vehiculos"("codigo");



ALTER TABLE ONLY "public"."vehiculos"
    ADD CONSTRAINT "vehiculos_centro_costo_id_fkey" FOREIGN KEY ("centro_costo_id") REFERENCES "public"."centros_costo"("id");



CREATE POLICY "Insert anónimo en cargas_gasolina" ON "public"."cargas_gasolina" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "Select anónimo en cargas_gasolina" ON "public"."cargas_gasolina" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."cargas_gasolina" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_asociar_cargas_al_cerrar"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_asociar_cargas_al_cerrar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_asociar_cargas_al_cerrar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_fotos_cargas_nuevas"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_fotos_cargas_nuevas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_fotos_cargas_nuevas"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_fuel_por_recorridos"("p_recorrido_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_fuel_por_recorridos"("p_recorrido_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_fuel_por_recorridos"("p_recorrido_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_centro_costo"("p_nombre" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_centro_costo"("p_nombre" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_centro_costo"("p_nombre" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_conductor"("p_nombre" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_conductor"("p_nombre" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_conductor"("p_nombre" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_siguiente_accion_por_vehiculo"("p_vehiculo_codigo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_siguiente_accion_por_vehiculo"("p_vehiculo_codigo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_siguiente_accion_por_vehiculo"("p_vehiculo_codigo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_siguiente_accion_recorrido"("p_recorrido_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_siguiente_accion_recorrido"("p_recorrido_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_siguiente_accion_recorrido"("p_recorrido_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_km_actual_vehiculo_desde_recorrido"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_km_parada"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_km_parada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_km_parada"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_km_recorrido"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_km_recorrido"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_km_recorrido"() TO "service_role";



GRANT ALL ON TABLE "public"."cargas_gasolina" TO "anon";
GRANT ALL ON TABLE "public"."cargas_gasolina" TO "authenticated";
GRANT ALL ON TABLE "public"."cargas_gasolina" TO "service_role";



GRANT ALL ON TABLE "public"."centros_costo" TO "anon";
GRANT ALL ON TABLE "public"."centros_costo" TO "authenticated";
GRANT ALL ON TABLE "public"."centros_costo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."centros_costo_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."centros_costo_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."centros_costo_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."conductores" TO "anon";
GRANT ALL ON TABLE "public"."conductores" TO "authenticated";
GRANT ALL ON TABLE "public"."conductores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."conductores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."conductores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."conductores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recorridos" TO "anon";
GRANT ALL ON TABLE "public"."recorridos" TO "authenticated";
GRANT ALL ON TABLE "public"."recorridos" TO "service_role";



GRANT ALL ON TABLE "public"."recorridos_paradas" TO "anon";
GRANT ALL ON TABLE "public"."recorridos_paradas" TO "authenticated";
GRANT ALL ON TABLE "public"."recorridos_paradas" TO "service_role";



GRANT ALL ON TABLE "public"."vehiculos" TO "anon";
GRANT ALL ON TABLE "public"."vehiculos" TO "authenticated";
GRANT ALL ON TABLE "public"."vehiculos" TO "service_role";



GRANT ALL ON TABLE "public"."vehiculos_bajas" TO "anon";
GRANT ALL ON TABLE "public"."vehiculos_bajas" TO "authenticated";
GRANT ALL ON TABLE "public"."vehiculos_bajas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vehiculos_bajas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vehiculos_bajas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vehiculos_bajas_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







