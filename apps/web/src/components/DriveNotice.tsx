import { Button, cn } from "@alexandernygard/components"
import { DriveLogo } from "@alexandernygard/drive/react"
import { drive, driveFileId, useCollab } from "../lib/collab"

/** Why a Drive document isn't open (signed out, no access), or that you can only view it. */
export function DriveNotice() {
  const failure = useCollab((s) => s.failure)
  const needsSignIn = useCollab((s) => s.needsSignIn)
  const readOnly = useCollab((s) => s.readOnly)
  if (!driveFileId || (!failure && !readOnly)) return null
  return (
    <div className={cn("flex items-center gap-3 border-b px-4 py-2 text-sm", failure ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
      <DriveLogo size={18} />
      <span className="flex-1">{failure ?? "You can view this document. Ask the owner for edit access to make changes."}</span>
      {needsSignIn && (
        <Button size="sm" asChild>
          <a href={drive.loginUrl()}>Sign in</a>
        </Button>
      )}
    </div>
  )
}
