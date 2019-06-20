interface Options {
    config: string;
    output: string;
    global?: string;
    module?: "esm" | "cjs";
}
export function compile(options: Options): void;
export function watch(options: Options): void;