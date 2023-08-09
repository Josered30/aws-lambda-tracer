import { MiddlewareObj } from "@middy/core";

export interface MatrixTracer {
  captureAWSv3Client<T>(service: T): T;
  tracerMiddleware<TEvent, TResult>(): MiddlewareObj<TEvent, TResult>;
}
