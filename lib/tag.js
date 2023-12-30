/**
 * use a tagged template for SQL
 */
export const useTag = async () => {
	// get db instance
	const db = {}

	const defaultOpts = {
		rowMode: 'array',
	}

	/**
	 * SQL tag function
	 * 
	 * @param {string[]} literals
	 * @param {...unknown} bind
	 * @return {unknown}
	 */
	function sql(literals, ...bind) {
		const query = {
			...defaultOpts,
			sql: literals.join('?'),
			bind,
		}
		return db.exec(query)
	}

	return {
		db,
		sql,
		SQL: sql,
	}
}
