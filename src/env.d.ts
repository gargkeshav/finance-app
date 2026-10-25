/// <reference types="vite/client" />

interface FinanceFileHandle {
	readonly name: string;
	getFile(): Promise<File>;
	createWritable(): Promise<{
		write(data: string): Promise<void>;
		close(): Promise<void>;
		abort?(): Promise<void>;
	}>;
}

interface Window {
	showOpenFilePicker?: (options?: {
		types?: Array<{ description?: string; accept: Record<string, string[]> }>;
		excludeAcceptAllOption?: boolean;
		multiple?: boolean;
	}) => Promise<FinanceFileHandle[]>;
	showSaveFilePicker?: (options?: {
		suggestedName?: string;
		types?: Array<{ description?: string; accept: Record<string, string[]> }>;
		excludeAcceptAllOption?: boolean;
	}) => Promise<FinanceFileHandle>;
}
