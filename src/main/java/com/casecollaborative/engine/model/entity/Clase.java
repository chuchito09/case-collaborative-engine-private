package com.casecollaborative.engine.model.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.ZonedDateTime;

@Entity
@Table(name = "clase")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Clase {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "diagrama_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private DiagramaUml diagrama;

    @OneToMany(mappedBy = "clase", cascade = CascadeType.ALL, fetch = FetchType.EAGER, orphanRemoval = true)
    @Builder.Default
    private java.util.List<Atributo> atributos = new java.util.ArrayList<>();

    @Column(nullable = false, length = 100)
    private String nombre;

    @Column(length = 50)
    @Builder.Default
    private String estereotipo = "CLASS";

    @Column(length = 20)
    @Builder.Default
    private String visibilidad = "public";

    @Column(name = "pos_x")
    @Builder.Default
    private Double posX = 0.0;

    @Column(name = "pos_y")
    @Builder.Default
    private Double posY = 0.0;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "bloqueado_por_id")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Usuario bloqueadoPor;

    @Column(name = "bloqueado_en")
    private ZonedDateTime bloqueadoEn;

    @Column(name = "metodos_json", columnDefinition = "TEXT")
    private String metodosJson;

    @Transient
    private java.util.List<java.util.Map<String, Object>> metodos;

    public java.util.List<java.util.Map<String, Object>> getMetodos() {
        if (metodos != null) return metodos;
        if (metodosJson == null || metodosJson.isBlank()) {
            return new java.util.ArrayList<>();
        }
        try {
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            return mapper.readValue(metodosJson, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<java.util.Map<String, Object>>>() {});
        } catch (Exception e) {
            return new java.util.ArrayList<>();
        }
    }

    public void setMetodos(java.util.List<java.util.Map<String, Object>> metodos) {
        this.metodos = metodos;
        if (metodos == null || metodos.isEmpty()) {
            this.metodosJson = null;
        } else {
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                this.metodosJson = mapper.writeValueAsString(metodos);
            } catch (Exception e) {
                this.metodosJson = null;
            }
        }
    }
}
