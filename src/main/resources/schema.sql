-- schema.sql
-- FASE 1: Esquema de base de datos para CASE Collaborative Database

CREATE TABLE IF NOT EXISTS rol (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS usuario (
    id BIGSERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    correo VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usuario_rol (
    usuario_id BIGINT NOT NULL,
    rol_id BIGINT NOT NULL,
    PRIMARY KEY (usuario_id, rol_id),
    CONSTRAINT fk_ur_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE,
    CONSTRAINT fk_ur_rol FOREIGN KEY (rol_id) REFERENCES rol (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proyecto (
    id BIGSERIAL PRIMARY KEY,
    propietario_id BIGINT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    estado VARCHAR(30) DEFAULT 'ACTIVO',
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_proyecto_propietario FOREIGN KEY (propietario_id) REFERENCES usuario (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS proyecto_colaborador (
    proyecto_id BIGINT NOT NULL,
    colaborador_id BIGINT NOT NULL,
    fecha_asignacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (proyecto_id, colaborador_id),
    CONSTRAINT fk_pc_proyecto FOREIGN KEY (proyecto_id) REFERENCES proyecto (id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_colaborador FOREIGN KEY (colaborador_id) REFERENCES usuario (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sesion_colaborativa (
    id BIGSERIAL PRIMARY KEY,
    proyecto_id BIGINT NOT NULL,
    session_token VARCHAR(120) NOT NULL UNIQUE,
    host_usuario_id BIGINT NOT NULL,
    activa BOOLEAN DEFAULT TRUE,
    fecha_inicio TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMPTZ,
    CONSTRAINT fk_sc_proyecto FOREIGN KEY (proyecto_id) REFERENCES proyecto (id) ON DELETE CASCADE,
    CONSTRAINT fk_sc_host FOREIGN KEY (host_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS diagrama_uml (
    id BIGSERIAL PRIMARY KEY,
    proyecto_id BIGINT NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    version INT DEFAULT 1,
    zoom_canvas DOUBLE PRECISION DEFAULT 1.0,
    pan_x DOUBLE PRECISION DEFAULT 0.0,
    pan_y DOUBLE PRECISION DEFAULT 0.0,
    fecha_actualizacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_diagrama_proyecto FOREIGN KEY (proyecto_id) REFERENCES proyecto (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clase (
    id BIGSERIAL PRIMARY KEY,
    diagrama_id BIGINT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    visibilidad VARCHAR(20) DEFAULT 'public',
    pos_x DOUBLE PRECISION DEFAULT 0.0,
    pos_y DOUBLE PRECISION DEFAULT 0.0,
    bloqueado_por_id BIGINT,
    bloqueado_en TIMESTAMPTZ,
    CONSTRAINT fk_clase_diagrama FOREIGN KEY (diagrama_id) REFERENCES diagrama_uml (id) ON DELETE CASCADE,
    CONSTRAINT fk_clase_bloqueado_por FOREIGN KEY (bloqueado_por_id) REFERENCES usuario (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS atributo (
    id BIGSERIAL PRIMARY KEY,
    clase_id BIGINT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    tipo_dato VARCHAR(50) NOT NULL,
    visibilidad VARCHAR(20) DEFAULT 'private',
    es_pk BOOLEAN DEFAULT FALSE,
    orden INT DEFAULT 0,
    CONSTRAINT fk_atributo_clase FOREIGN KEY (clase_id) REFERENCES clase (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relacion_clase (
    id BIGSERIAL PRIMARY KEY,
    diagrama_id BIGINT NOT NULL,
    clase_origen_id BIGINT NOT NULL,
    clase_destino_id BIGINT NOT NULL,
    tipo_relacion VARCHAR(40) NOT NULL,
    nombre VARCHAR(100),
    cardinalidad_origen VARCHAR(10) DEFAULT '1',
    cardinalidad_destino VARCHAR(10) DEFAULT '1',
    CONSTRAINT fk_relacion_diagrama FOREIGN KEY (diagrama_id) REFERENCES diagrama_uml (id) ON DELETE CASCADE,
    CONSTRAINT fk_relacion_origen FOREIGN KEY (clase_origen_id) REFERENCES clase (id) ON DELETE CASCADE,
    CONSTRAINT fk_relacion_destino FOREIGN KEY (clase_destino_id) REFERENCES clase (id) ON DELETE CASCADE
);

ALTER TABLE relacion_clase ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
ALTER TABLE clase ADD COLUMN IF NOT EXISTS metodos_json TEXT;

CREATE TABLE IF NOT EXISTS metrica_kpi (
    id BIGSERIAL PRIMARY KEY,
    proyecto_id BIGINT NOT NULL,
    tiempo_modelado_seg INT DEFAULT 0,
    elementos_por_minuto NUMERIC(6,2) DEFAULT 0.0,
    acoplamiento_cbo NUMERIC(5,2) DEFAULT 0.0,
    violaciones_uml INT DEFAULT 0,
    tasa_compilacion NUMERIC(5,2) DEFAULT 0.0,
    CONSTRAINT fk_metrica_proyecto FOREIGN KEY (proyecto_id) REFERENCES proyecto (id) ON DELETE CASCADE
);

-- Índices B-Tree para optimización
CREATE INDEX IF NOT EXISTS idx_usuario_correo ON usuario(correo);
CREATE INDEX IF NOT EXISTS idx_proyecto_propietario ON proyecto(propietario_id);
CREATE INDEX IF NOT EXISTS idx_sesion_token ON sesion_colaborativa(session_token);
CREATE INDEX IF NOT EXISTS idx_sesion_proyecto ON sesion_colaborativa(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_diagrama_proyecto ON diagrama_uml(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_clase_diagrama ON clase(diagrama_id);
CREATE INDEX IF NOT EXISTS idx_atributo_clase ON atributo(clase_id);
CREATE INDEX IF NOT EXISTS idx_relacion_diagrama ON relacion_clase(diagrama_id);
CREATE INDEX IF NOT EXISTS idx_relacion_origen ON relacion_clase(clase_origen_id);
CREATE INDEX IF NOT EXISTS idx_relacion_destino ON relacion_clase(clase_destino_id);
CREATE INDEX IF NOT EXISTS idx_metrica_proyecto ON metrica_kpi(proyecto_id);

-- Inserción de roles iniciales
INSERT INTO rol (nombre, descripcion) VALUES ('ANFITRION', 'Creador y administrador del proyecto') ON CONFLICT DO NOTHING;
INSERT INTO rol (nombre, descripcion) VALUES ('COLABORADOR', 'Participante del proyecto con acceso a edición') ON CONFLICT DO NOTHING;
INSERT INTO rol (nombre, descripcion) VALUES ('OPERADOR_MOVIL', 'Usuario desde aplicación móvil con permisos específicos') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_idempotencia (
    mutation_uuid VARCHAR(60) PRIMARY KEY,
    session_token VARCHAR(120) NOT NULL,
    usuario_id BIGINT NOT NULL,
    tipo_mutacion VARCHAR(40) NOT NULL,
    procesado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_idempotencia_uuid ON sync_idempotencia(mutation_uuid);
