extends RefCounted


static func success(value: Variant) -> Dictionary:
	return {"ok": true, "value": value}


static func failure(code: String, message: String) -> Dictionary:
	return {"ok": false, "errorCode": code, "errorMessage": message}
