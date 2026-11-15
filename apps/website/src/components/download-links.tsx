import { Download } from 'lucide-react'
import { Button } from '~/components/ui/button'

interface DownloadLinksProps {
  label: string
  files: readonly { readonly text: string; readonly href: string }[]
}

export function DownloadLinks({ label, files }: DownloadLinksProps) {
  return (
    <nav aria-label={`下载${label}`} className="flex flex-wrap gap-2">
      {files.map(file => (
        <Button key={file.href} variant="outline" size="sm" asChild>
          <a href={file.href} download>
            <Download aria-hidden />
            {file.text}
          </a>
        </Button>
      ))}
    </nav>
  )
}
