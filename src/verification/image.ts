import { inspectImage } from '../media/inspection.js';
import { aggregateChecks, type VerificationCheck } from './model.js';

export interface ImageRequirements {
  width?: number;
  height?: number;
  formats?: Array<'png' | 'jpeg'>;
  minimumBytes?: number;
}

export async function verifyImage(path: string, requirements: ImageRequirements = {}) {
  const checks: VerificationCheck[] = [];
  let image;
  try {
    image = await inspectImage(path);
    checks.push({
      id: 'image.exists',
      status: 'pass',
      path,
      message: 'Image file exists and is readable',
    });
  } catch (error) {
    return aggregateChecks([
      {
        id: 'image.exists',
        status: 'fail',
        path,
        message: error instanceof Error ? error.message : String(error),
        remediation: 'Restore or regenerate the image',
      },
    ]);
  }
  checks.push({
    id: 'image.decode',
    status: image.format === 'unknown' ? 'fail' : 'pass',
    path,
    expected: requirements.formats ?? ['png', 'jpeg'],
    actual: image.format,
    message:
      image.format === 'unknown'
        ? 'Image format could not be decoded'
        : `Image decoded as ${image.format}`,
  });
  if (requirements.width !== undefined)
    checks.push({
      id: 'image.width',
      status: image.width === requirements.width ? 'pass' : 'fail',
      path,
      expected: requirements.width,
      actual: image.width,
      message: 'Image width matches requirement',
    });
  if (requirements.height !== undefined)
    checks.push({
      id: 'image.height',
      status: image.height === requirements.height ? 'pass' : 'fail',
      path,
      expected: requirements.height,
      actual: image.height,
      message: 'Image height matches requirement',
    });
  if (requirements.formats)
    checks.push({
      id: 'image.format',
      status: requirements.formats.includes(image.format as 'png' | 'jpeg') ? 'pass' : 'fail',
      path,
      expected: requirements.formats,
      actual: image.format,
      message: 'Image format is allowed',
    });
  const minimum = requirements.minimumBytes ?? 16;
  checks.push({
    id: 'image.size',
    status: image.bytes >= minimum ? 'pass' : 'warning',
    path,
    expected: `>= ${minimum}`,
    actual: image.bytes,
    message:
      image.bytes >= minimum ? 'Image file size is reasonable' : 'Image file is unusually small',
  });
  return aggregateChecks(checks);
}
