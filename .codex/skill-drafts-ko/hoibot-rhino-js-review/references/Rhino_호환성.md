# Rhino 호환성

JavaScript는 보수적인 syntax 선택으로 검토한다.

## 선호

- 기존 local pattern
- 주변 코드가 사용하는 경우 `var`
- 호환성이 불확실하면 plain function
- 기존 helper API
- repo에서 이미 사용하는 Android/MessengerBot API

## 주의

- 오래된 영역의 arrow function
- 주변 코드가 old style이면 `let`, `const`
- fragile area의 template literal
- 호환성이 불확실한 `Array.prototype` methods
- 오래된 engine에서 지원하지 않을 수 있는 regex features

현대화만을 위한 syntax refactor는 하지 않는다.
