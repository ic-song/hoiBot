import {
  isPackageCommandCandidate,
  normalizePackageDispatchMessage,
} from "./package-command.js";

export interface PackageDispatchInput {
  message: string;
  [key: string]: unknown;
}

export interface PackageDispatchPort<TInput extends PackageDispatchInput, TResult> {
  dispatch(input: TInput): Promise<TResult>;
}

// 동적 패키지 인자를 보존하면서 명령 별칭 조회만 정확 일치 값으로 변환하는 Dispatcher 어댑터
export class PackageDispatchAdapter<TInput extends PackageDispatchInput, TResult> {
  public constructor(private readonly dispatcher: PackageDispatchPort<TInput, TResult>) {}

  public dispatch(input: TInput): Promise<TResult> {
    if (!isPackageCommandCandidate(input.message)) {
      return this.dispatcher.dispatch(input);
    }

    return this.dispatcher.dispatch({
      ...input,
      message: normalizePackageDispatchMessage(input.message),
      originalMessage: input.message,
    });
  }
}
