import { MatrixTracer } from "../interfaces/matrix.tracer";
import { MatrixTracerType } from "../constants/matrix-tracer-type.enum";

import middy, { MiddlewareObj } from "@middy/core";
import { Tracer, captureLambdaHandler } from "@aws-lambda-powertools/tracer";
import { TRACER_KEY } from "@aws-lambda-powertools/commons/lib/middleware";
import TraceID from "aws-xray-sdk-core/dist/lib/segments/attributes/trace_id";
import AWSXRay, { Subsegment } from "aws-xray-sdk-core";

export class MatrixLambdaTracer implements MatrixTracer {
  public readonly matrixTracerType: MatrixTracerType;
  public readonly powertoolTracer: Tracer;

  constructor(matrixTracerType: MatrixTracerType) {
    this.matrixTracerType = matrixTracerType;
    this.powertoolTracer = new Tracer();
  }

  tracerMiddleware<TEvent, TResult>(): MiddlewareObj<TEvent, TResult> {
    if (this.matrixTracerType === MatrixTracerType.CLIENT) {
      return captureLambdaHandler(this.powertoolTracer);
    }

    const xRayTracerMiddleware = <TEvent, TResult>(
      tracer: Tracer
    ): middy.MiddlewareObj<TEvent, TResult> => {
      let lambdaSegment: any;
      let handlerSegment: Subsegment;

      const setCleanupFunction = (
        request: middy.Request<TEvent, TResult>
      ): void => {
        request.internal = {
          ...request.internal,
          [TRACER_KEY]: close,
        };
      };

      const open = (request: middy.Request<TEvent, TResult>) => {
        const { context } = request;

        const newTraceId = new TraceID().toString();
        process.env._X_AMZN_TRACE_ID = `Root=${newTraceId};Parent=;Sampled=1`;

        lambdaSegment = new AWSXRay.Segment(
          context.functionName,
          newTraceId,
          null
        );

        const awsAccountId = context.invokedFunctionArn.split(":")[4];
        lambdaSegment.origin = "AWS::Lambda::Function";
        // segment.resource_arn = context.invokedFunctionArn;
        lambdaSegment.aws = {
          account_id: awsAccountId,
          function_arn: context.invokedFunctionArn,
          resource_names: [context.functionName],
        };

        process.env._X_AMZN_TRACE_ID = `Root=${lambdaSegment.id};Parent=;Sampled=1`;

        // Create subsegment for the function & set it as active
        tracer.setSegment(lambdaSegment);

        handlerSegment = lambdaSegment.addNewSubsegment(
          `## ${process.env._HANDLER}`
        );
        tracer.setSegment(handlerSegment);
      };

      const close = (): void => {
        if (handlerSegment === undefined || lambdaSegment === null) {
          return;
        }

        handlerSegment.close();
        tracer.setSegment(lambdaSegment);

        if (!lambdaSegment.isClosed()) {
          lambdaSegment.close();
          lambdaSegment.flush();
        }
      };

      const before: middy.MiddlewareFn<TEvent, TResult> = async (
        request
      ): Promise<void> => {
        if (!tracer.isTracingEnabled()) {
          return;
        }

        open(request);
        setCleanupFunction(request);

        tracer.annotateColdStart();
        tracer.addServiceNameAnnotation();
      };

      const after: middy.MiddlewareFn<TEvent, TResult> = async (
        request
      ): Promise<void> => {
        if (tracer.isTracingEnabled()) {
          tracer.addResponseAsMetadata(request.response, process.env._HANDLER);
          close();
        }
      };

      const onError: middy.MiddlewareFn<TEvent, TResult> = async (
        request
      ): Promise<void> => {
        if (tracer.isTracingEnabled()) {
          if (request.error) {
            tracer.addErrorAsMetadata(request.error);
          }
          close();
        }
      };

      return {
        before,
        after,
        onError,
      };
    };

    return xRayTracerMiddleware(this.powertoolTracer);
  }

  captureAWSv3Client<T>(service: T): T {
    return this.powertoolTracer.captureAWSv3Client(service);
  }
}
