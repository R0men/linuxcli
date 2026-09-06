const components = {};

export function useMDXComponents(existingComponents) {
  return { ...existingComponents, ...components };
}
