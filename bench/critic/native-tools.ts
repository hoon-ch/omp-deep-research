/** Headless benchmark adapter: activate OMP's real registered native tools, never substitute implementations. */
interface NativeToolApi {
  registerCommand(name: string, command: { description: string; handler: () => Promise<void> }): void;
  getAllTools(): { name: string }[];
  getActiveTools(): string[];
  setActiveTools(names: string[]): Promise<void>;
}
export default function (pi: NativeToolApi) {
  pi.registerCommand("critic-bench-native-tools", {
    description: "Activate the registered native autoresearch tools for the fixed benchmark",
    handler: async () => {
      const required = ["init_experiment", "run_experiment", "log_experiment"];
      const registered = pi.getAllTools().map(t => t.name);
      for (const name of required) if (!registered.includes(name)) throw new Error(`Native OMP tool is not registered: ${name}`);
      await pi.setActiveTools([...new Set([...pi.getActiveTools(), ...required])]);
    },
  });
}
