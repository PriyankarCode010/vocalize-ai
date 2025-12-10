import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  HandRaisedIcon ,
  SpeakerWaveIcon,
  LanguageIcon,
  MicrophoneIcon,
  ArrowRightIcon,
  CheckIcon,
  GlobeAltIcon,
  HeartIcon,
} from "@heroicons/react/24/outline"

export default function HomePage() {
  console.log("HomePage")
  return (
    <div className="bg-background">
      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto text-center max-w-4xl">
          <Badge variant="secondary" className="mb-4">
            AI-Powered Communication
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 text-balance">
            Breaking Communication Barriers with <span className="text-accent">AI Technology</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8 text-pretty max-w-2xl mx-auto">
            Empowering individuals with hearing and speech disabilities to communicate effortlessly through advanced
            hand sign recognition, text conversion, and multilingual speech synthesis.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground">
              Get Started Free
              <ArrowRightIcon className="ml-2 w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline">
              Watch Demo
            </Button>
          </div>

          {/* Hero Visual */}
          <div className="mt-16 relative">
            <div className="bg-card rounded-2xl p-8 shadow-lg border border-border">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="text-center">
                  <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <HandRaisedIcon  className="w-8 h-8 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Hand Signs</p>
                </div>
                <div className="text-center">
                  <ArrowRightIcon className="w-8 h-8 text-accent mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">AI Processing</p>
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <SpeakerWaveIcon className="w-8 h-8 text-accent" />
                  </div>
                  <p className="text-sm text-muted-foreground">Speech & Text</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Comprehensive Communication Solution
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Our AI-powered platform offers bidirectional communication support with cutting-edge technology
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <HandRaisedIcon  className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>Sign to Speech</CardTitle>
                <CardDescription>
                  Advanced computer vision recognizes hand signs and converts them to natural speech in real-time
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <MicrophoneIcon className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>Speech to Text</CardTitle>
                <CardDescription>
                  High-accuracy speech recognition converts audio to text for deaf and hard-of-hearing users
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <LanguageIcon className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>Multilingual Support</CardTitle>
                <CardDescription>
                  Support for multiple languages and regional sign language variations powered by Sarvam AI
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <GlobeAltIcon className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>API Integration</CardTitle>
                <CardDescription>
                  RESTful API for developers to integrate communication features into their applications
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <CheckIcon className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>Real-time Processing</CardTitle>
                <CardDescription>
                  Lightning-fast AI processing ensures smooth, natural conversations without delays
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center mb-4">
                  <HeartIcon className="w-6 h-6 text-accent" />
                </div>
                <CardTitle>Accessibility First</CardTitle>
                <CardDescription>
                  Designed with accessibility principles to ensure inclusive communication for everyone
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">How SignSpeak Works</h2>
            <p className="text-xl text-muted-foreground">Simple, intuitive, and powered by advanced AI technology</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground font-bold text-sm">
                  1
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Capture Hand Signs</h3>
                  <p className="text-muted-foreground">
                    Use your device&apos;s camera to capture hand signs in real-time with our advanced computer vision
                    technology.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground font-bold text-sm">
                  2
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">AI Processing</h3>
                  <p className="text-muted-foreground">
                    Our AI models, powered by Sarvam AI, process and interpret the signs with high accuracy across
                    multiple languages.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-accent-foreground font-bold text-sm">
                  3
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">Output Generation</h3>
                  <p className="text-muted-foreground">
                    Get instant text and natural speech output, enabling seamless communication with anyone.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-8 border border-border">
              <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <HandRaisedIcon  className="w-8 h-8 text-accent" />
                  </div>
                  <p className="text-muted-foreground">Interactive Demo Coming Soon</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Request Section */}
      <section id="demo" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto max-w-2xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Request a Demo</h2>
            <p className="text-xl text-muted-foreground">Experience the power of AI-driven communication technology</p>
          </div>

          <Card className="border-border">
            <CardContent className="p-8">
              <form className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
                      Full Name
                    </label>
                    <Input id="name" placeholder="Enter your name" />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                      Email Address
                    </label>
                    <Input id="email" type="email" placeholder="Enter your email" />
                  </div>
                </div>

                <div>
                  <label htmlFor="organization" className="block text-sm font-medium text-foreground mb-2">
                    Organization (Optional)
                  </label>
                  <Input id="organization" placeholder="Your organization or institution" />
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-foreground mb-2">
                    Tell us about your needs
                  </label>
                  <Textarea
                    id="message"
                    placeholder="How would you like to use SignSpeak? Any specific requirements?"
                    rows={4}
                  />
                </div>

                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" size="lg">
                  Request Demo
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

    </div>
  )
}
