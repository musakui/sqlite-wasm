const __ptrMap = new WeakMap()
const __stmtMap = new WeakMap()

export class DB {
	constructor() {
		
	}

	get pointer() {
		return __ptrMap.get(this)
	}

	isOpen() {
		return !!this.pointer
	}
}