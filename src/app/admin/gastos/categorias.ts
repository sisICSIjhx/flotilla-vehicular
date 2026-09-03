// Categorías del gasto consolidado: combustible + mantenimientos + refacciones/otros.
// Compartidas entre la vista y la exportación para mantener el mismo orden y etiquetas.

export const CATEGORIA_LABELS = ['Combustible', 'Mantenimiento', 'Refacciones', 'Otros gastos'] as const

export type CategoriaLabel = (typeof CATEGORIA_LABELS)[number]
