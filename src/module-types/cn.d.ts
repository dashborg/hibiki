declare module "classnames/dedupe" {
    type ClassValue = string | number | undefined | null | Record<string, any> | any[] | boolean;

    export default function cn(...rest : ClassValue[]) : string;
}
