import Link from "next/link"

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-2">
            <p className="text-lg font-semibold">vocalize</p>
            <p className="text-sm text-muted-foreground">
              AI-first communication assistant bridging the gap between spoken language and sign language.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Product</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <Link href="/#features" className="hover:text-foreground">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/demo" className="hover:text-foreground">
                  Interactive demo
                </Link>
              </li>
              <li>
                <Link href="/meeting/new" className="hover:text-foreground">
                  Virtual call rooms
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Company</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <a href="mailto:hello@signspeak.ai" className="hover:text-foreground">
                  Contact
                </a>
              </li>
              <li>
                <Link href="/login" className="hover:text-foreground">
                  Customer portal
                </Link>
              </li>
              <li>
                <Link href="/signup" className="hover:text-foreground">
                  Become a partner
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-4 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} vocalize. All rights reserved.
        </div>
      </div>
    </footer>
  )
}



